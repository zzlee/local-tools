#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const { program } = require('commander');
const readline = require('readline');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to proceed.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * List labels (folders or tags)
 */
async function listLabels(auth, labelTypeFilter) {
  const gmail = google.gmail({ version: 'v1', auth });
  try {
    const res = await gmail.users.labels.list({ userId: 'me' });
    let labels = res.data.labels || [];

    if (labels.length === 0) {
      console.log('No labels found.');
      return;
    }

    if (labelTypeFilter) {
      labels = labels.filter(l => l.type.toLowerCase() === labelTypeFilter.toLowerCase());
      const displayTitle = labelTypeFilter === 'system' ? 'Folders (System)' : 'Tags (User)';
      console.log(`--- ${displayTitle} ---`);
    } else {
      console.log('--- All Labels ---');
    }

    console.log(`${'ID'.padEnd(30)} | Name`);
    console.log('-'.repeat(60));
    labels.forEach((label) => {
      console.log(`${label.id.padEnd(30)} | ${label.name}`);
    });
    console.log(`Total: ${labels.length}`);
  } catch (err) {
    console.error(`An error occurred: ${err.message}`);
  }
}

/**
 * List messages based on query
 */
async function listMessages(auth, query, limit = 10) {
  const gmail = google.gmail({ version: 'v1', auth });
  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: limit,
    });
    const messages = res.data.messages || [];

    if (messages.length === 0) {
      console.log(`No messages found for query: '${query}'`);
      return;
    }

    console.log(`${'ID'.padEnd(20)} | Subject`);
    console.log('-'.repeat(80));

    for (const msg of messages) {
      const msgDetail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject'],
      });
      const headers = msgDetail.data.payload.headers || [];
      const subject = (headers.find(h => h.name === 'Subject') || { value: '(No Subject)' }).value;
      console.log(`${msg.id.padEnd(20)} | ${subject}`);
    }
  } catch (err) {
    console.error(`An error occurred: ${err.message}`);
  }
}

/**
 * Count total messages matching query
 */
async function countMessages(auth, query) {
  console.log(`Calculating matching messages for: '${query}'...`);
  const gmail = google.gmail({ version: 'v1', auth });
  let totalCount = 0;
  let pageToken = null;

  try {
    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        pageToken: pageToken,
        includeSpamTrash: false,
      });
      const messages = res.data.messages || [];
      totalCount += messages.length;
      pageToken = res.data.nextPageToken;
      process.stdout.write(`Found ${totalCount} messages...\r`);
    } while (pageToken);

    console.log(`\nTotal messages found: ${totalCount}`);
    return totalCount;
  } catch (err) {
    console.error(`\nAn error occurred: ${err.message}`);
    return 0;
  }
}

/**
 * Download message as .eml
 */
async function downloadMessage(auth, msgId) {
  const gmail = google.gmail({ version: 'v1', auth });
  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: msgId,
      format: 'raw',
    });
    const buffer = Buffer.from(res.data.raw, 'base64url');
    const filename = `${msgId}.eml`;
    await fs.writeFile(filename, buffer);
    console.log(`Email downloaded successfully: ${filename}`);
  } catch (err) {
    console.error(`An error occurred: ${err.message}`);
  }
}

/**
 * Delete messages matching query with confirmation
 */
async function deleteAllMessages(auth, query) {
  console.log('--- Pre-check ---');
  const count = await countMessages(auth, query);

  if (count === 0) {
    console.log('No messages to delete.');
    return;
  }

  console.log(`\nWARNING: You are about to DELETE ${count} emails matching: '${query}'`);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const confirm = await new Promise(resolve => {
    rl.question("Type 'yes' to confirm deletion: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });

  if (confirm.toLowerCase() !== 'yes') {
    console.log('Operation cancelled.');
    return;
  }

  const gmail = google.gmail({ version: 'v1', auth });
  let totalDeleted = 0;

  try {
    while (true) {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
      });
      const messages = res.data.messages || [];

      if (messages.length === 0) {
        console.log('No more messages found matching the criteria.');
        break;
      }

      const idsToDelete = messages.map(msg => msg.id);
      console.log(`Deleting batch of ${idsToDelete.length} messages...`);

      await gmail.users.messages.batchDelete({
        userId: 'me',
        requestBody: {
          ids: idsToDelete,
        },
      });

      totalDeleted += idsToDelete.length;
      console.log(`Deleted so far: ${totalDeleted}`);
    }
    console.log(`Done. Total ${totalDeleted} messages deleted.`);
  } catch (err) {
    console.error(`An error occurred: ${err.message}`);
  }
}

program
  .name('gmail-cli')
  .description('Gmail CLI Tool')
  .version('1.0.0');

program
  .command('list-folders')
  .description('List system folders')
  .action(async () => {
    const auth = await authorize();
    await listLabels(auth, 'system');
  });

program
  .command('list-tags')
  .description('List user tags')
  .action(async () => {
    const auth = await authorize();
    await listLabels(auth, 'user');
  });

program
  .command('search')
  .description('Search emails and show IDs')
  .requiredOption('-q, --query <string>', 'Gmail search query')
  .option('-n, --limit <number>', 'Max results to show', parseInt, 10)
  .action(async (options) => {
    const auth = await authorize();
    await listMessages(auth, options.query, options.limit);
  });

program
  .command('count')
  .description('Count total emails matching query')
  .requiredOption('-q, --query <string>', 'Gmail search query')
  .action(async (options) => {
    const auth = await authorize();
    await countMessages(auth, options.query);
  });

program
  .command('download <id>')
  .description('Download email by ID')
  .action(async (id) => {
    const auth = await authorize();
    await downloadMessage(auth, id);
  });

program
  .command('delete-all')
  .description('Recursively delete emails matching query')
  .requiredOption('-q, --query <string>', 'Gmail search query for deletion')
  .action(async (options) => {
    const auth = await authorize();
    await deleteAllMessages(auth, options.query);
  });

program.parse();
