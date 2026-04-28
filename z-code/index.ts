#!/usr/bin/env node

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as dotenv from "dotenv";
import * as yaml from "js-yaml";
import chalk from "chalk";
import ora from "ora";
import { 
  ToolRegistry, 
  ReadTool, 
  BashTool, 
  GlobTool, 
  EditTool, 
  GrepTool, 
  WriteTool,
  ApplyPatchTool,
} from "./packages/tools/index.js";
import type { ToolContext } from "./packages/tools/index.js";

const COMMANDS_DIR = "prompts/commands";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`
Usage: z-code [options] [query]

Options:
  -h, --help                Show this help message
  -v, --verbose [level]     Set verbosity level (0: thinking and tool progress, 1: tool progress, 2: tool output)
  -m, --model <model>       Specify the Gemini model (default: GEMINI_MODEL env var or gemini-2.5-flash)
  -p, --prompt <path>       Specify a custom system prompt file (default: prompts/default.txt)
  -s, --session <id>        Resume a session with the given ID
  -f, --fork                Pre-spawn the session with the system prompt
  -o, --output <path>       Save the final cleaned output to a file
  -c, --continue            Resume the last session or create a new one:
  --dry-run                 Show expanded prompt for custom commands without executing
  --list-sessions           List all sessions
  --show-session <id>       Show history of a specific session
  --delete-session <id>     Delete a specific session
  --delete-all-sessions     Delete all sessions
  --list-commands           List available custom command templates

Custom Commands:
  /<command> [args...]      Use a custom command template (e.g., /review "some text")
                            Templates are located in prompts/commands/

You can also provide the query via stdin.
`);
}

function parseArgs(args: string[]) {
  const options: any = {
    verbosity: 0,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    promptPath: "prompts/default.md",
    sessionId: null,
    continueSession: false,
    fork: false,
    dryRun: false,
    output: null,
    listSessions: false,
    showSessionId: null,
    deleteSessionId: null,
    deleteAllSessions: false,
    listCommands: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "-v" || arg === "--verbose") {
      const next = args[i + 1];
      if (next && /^\d+$/.test(next)) {
        options.verbosity = parseInt(next, 10);
        i++;
      } else {
        options.verbosity = 1;
      }
    } else if (arg === "-m" || arg === "--model") {
      options.model = args[++i];
    } else if (arg === "-p" || arg === "--prompt") {
      options.promptPath = args[++i];
    } else if (arg === "-s" || arg === "--session") {
      options.sessionId = args[++i];
    } else if (arg === "-c" || arg === "--continue") {
      options.continueSession = true;
    } else if (arg === "-f" || arg === "--fork") {
      options.fork = true;
    } else if (arg === "-o" || arg === "--output") {
      options.output = args[++i];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--list-sessions") {
      options.listSessions = true;
    } else if (arg === "--show-session") {
      options.showSessionId = args[++i];
    } else if (arg === "--delete-session") {
      options.deleteSessionId = args[++i];
    } else if (arg === "--delete-all-sessions") {
      options.deleteAllSessions = true;
    } else if (arg === "--list-commands") {
      options.listCommands = true;
    } else {
      positional.push(arg);
    }
  }

  return { options, positional };
}

async function loadPrompt(filePath: string) {
  const content = await fs.readFile(filePath, "utf8");
  const match = content.match(/^---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: content };
  }
  const metadata = yaml.load(match[1]) as any;
  const body = match[2].trim();
  return { metadata, body };
}

async function loadAgentsMd() {
  try {
    const agentsMdPath = path.join(process.cwd(), "AGENTS.md");
    await fs.access(agentsMdPath);
    const content = await fs.readFile(agentsMdPath, "utf8");
    return `\n\n## Project-Specific Information (AGENTS.md)\n\n${content}`;
  } catch {
    return "";
  }
}

function expandTemplate(content: string, args: string[], argumentsDef: any[] = []) {
  let expanded = content;
  if (argumentsDef && argumentsDef.length > 0) {
    for (let i = 0; i < argumentsDef.length; i++) {
      const argName = argumentsDef[i].name;
      const argValue = args[i] || "";
      expanded = expanded.replaceAll(`{{${argName}}}`, argValue);
    }
  } else {
    for (let i = 0; i < args.length; i++) {
      expanded = expanded.replaceAll(`{{arg${i}}}`, args[i]);
    }
  }
  return expanded;
}

async function main() {
  dotenv.config({quiet: true});
  dotenv.config({ path: path.join(os.homedir(), ".env"), quiet: true });

  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, () => {
      console.log(chalk.yellow(`\n\n🛑 Session interrupted by ${signal}`));
      console.log(chalk.gray("You can resume this conversation with: z-code -c"));
      process.exit(0);
    });
  });
  const SESSION_ROOT = path.join(process.cwd(), ".z-code", "sessions");
 
  async function listSessions() {
    try {
      const entries = await fs.readdir(SESSION_ROOT);
      const sessionData = await Promise.all(
        entries.map(async (id) => {
          const stats = await fs.stat(path.join(SESSION_ROOT, id));
          return { id, mtime: stats.mtime };
        })
      );
 
      sessionData.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
 
      if (sessionData.length === 0) {
        console.log("No sessions found.");
        return;
      }
 
      console.log(chalk.bold("\nActive Sessions (newest first):"));
      console.log("--------------------------------------------------------------------------------");
      for (const { id, mtime } of sessionData) {
        console.log(`${chalk.cyan(id).padEnd(36)} ${mtime.toLocaleString()}`);
      }
      console.log("--------------------------------------------------------------------------------\n");
    } catch (e: any) {
      if (e.code === "ENOENT") {
        console.log("No sessions found.");
      } else {
        console.error(chalk.red(`Error listing sessions: ${e.message}`));
      }
    }
  }
 
  async function deleteSession(id: string) {
    const sessionDir = path.join(SESSION_ROOT, id);
    try {
      await fs.access(sessionDir);
      await fs.rm(sessionDir, { recursive: true, force: true });
      console.log(chalk.green(`Session ${id} deleted.`));
    } catch (e: any) {
      if (e.code === "ENOENT") {
        console.error(chalk.red(`Session ${id} not found.`));
      } else {
        console.error(chalk.red(`Error deleting session ${id}: ${e.message}`));
      }
    }
  }
 
  async function deleteAllSessions() {
    try {
      await fs.rm(SESSION_ROOT, { recursive: true, force: true });
      console.log(chalk.green("All sessions deleted."));
    } catch (e: any) {
      if (e.code === "ENOENT") {
        console.log("No sessions to delete.");
      } else {
        console.error(chalk.red(`Error deleting all sessions: ${e.message}`));
      }
    }
  }

  async function showSession(id: string) {
    const sessionDir = path.join(SESSION_ROOT, id);
    try {
      const historyData = await fs.readFile(path.join(sessionDir, "history.json"), "utf8");
      const messages = JSON.parse(historyData);
      
      console.log(chalk.bold(`\n📜 Session Playback: ${id}`));
      console.log(chalk.gray("=".repeat(80)) + "\n");
      
      const toolIcons: Record<string, string> = {
        bash: '🐚',
        read: '📄',
        write: '📄',
        grep: '🔍',
        glob: '🔍',
        edit: '📝',
      };

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const isModel = message.role === "model";
        const roleLabel = isModel ? "🤖 Assistant" : "👤 User";
        const roleColor = isModel ? chalk.green : chalk.cyan;
        
        console.log(`${roleColor(chalk.bold(roleLabel))}`);
        
        for (const part of message.parts || []) {
          if (part.text) {
            if (part.thought) {
              console.log(chalk.gray(`  💭 Thinking:\n    ${part.text.trim()}`));
            } else {
              console.log(`  ${part.text}`);
            }
          } else if (part.functionCall) {
            const { name, args } = part.functionCall;
            let details = "";
            if (name === "bash") {
              details = `${args.description || ""} ${args.command || ""}`;
            } else if (name === "edit") {
              details = args.filePath || "";
            } else if (name === "grep") {
              details = args.pattern || "";
            } else if (name === "glob") {
              details = args.description || args.pattern || "";
            } else if (name === "read") {
              details = `${args.filePath || ""} ${args.offset ? `offset=${args.offset}` : ""} ${args.limit ? `limit=${args.limit}` : ""}`;
            } else if (name === "write") {
              details = args.filePath || "";
            }
            const output = details ? `${name} ${details}` : name;
            console.log(chalk.yellow(`  🛠️  Call: ${output.trim()}`));
          } else if (part.functionResponse) {
            const { name, response } = part.functionResponse;
            const icon = toolIcons[name] || '⚙️';
            const content = response.output || response.error || "No output";
            
            console.log(chalk.blue(`  📥 Response from ${name}: ${icon}`));
            
            const lines = content.split('\n');
            if (lines.length > 15) {
              const head = lines.slice(0, 10).join('\n');
              const tail = lines.slice(-5).join('\n');
              console.log(chalk.gray(`    ${head}\n    ... [truncated] ...\n    ${tail}`));
            } else {
              console.log(chalk.gray(`    ${content}`));
            }
          }
        }
        
        if (!isModel) {
          console.log(chalk.gray("\n" + "─".repeat(40)));
        } else {
          console.log("");
        }
      }
      console.log(chalk.gray("=".repeat(80)) + "\n");
    } catch (e: any) {
      if (e.code === "ENOENT") {
        console.error(chalk.red(`Session ${id} not found.`));
      } else {
        console.error(chalk.red(`Error showing session ${id}: ${e.message}`));
      }
    }
  }


  async function spawnSession(id: string, promptPath?: string) {
    const sessionDir = path.join(SESSION_ROOT, id);
    try {
      await fs.access(sessionDir);
      return;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(chalk.red(`Error checking session existence: ${e.message}`));
        process.exit(1);
      }
    }

    const resolvedPromptPath = promptPath 
      ? (promptPath.startsWith("/") || path.isAbsolute(promptPath) ? promptPath : path.join(process.cwd(), promptPath))
      : (options.promptPath.startsWith("/") || path.isAbsolute(options.promptPath) ? options.promptPath : path.join(__dirname, options.promptPath));

    try {
      const { metadata, body } = await loadPrompt(resolvedPromptPath);
      const toolDescriptions = registry.listTools()
        .map(t => `${t.id}: ${t.description}`)
        .join("\n");
      const agentsMdContent = await loadAgentsMd();
      const systemPrompt = `${expandTemplate(body, [], metadata.arguments)}${agentsMdContent}\n\nAvailable Tools:\n${toolDescriptions}`;

      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(path.join(sessionDir, "system_prompt.txt"), systemPrompt);
      await fs.writeFile(path.join(sessionDir, "history.json"), "[]");

      console.log(chalk.green(`Session ${id} spawned successfully.`));
    } catch (e: any) {
      console.error(chalk.red(`Error spawning session: ${e.message}`));
      process.exit(1);
    }
  }
 
  const { options, positional } = parseArgs(process.argv.slice(2));

  let finalOutputBuffer = "";
 
  // Custom command detection
  if (positional.length > 0) {
    const firstArg = positional[0];
    if (firstArg.startsWith("/")) {
      const commandName = firstArg.slice(1);
      const commandPath = path.join(__dirname, COMMANDS_DIR, `${commandName}.md`);
      try {
        await fs.access(commandPath);
        options.customCommand = commandName;
         options.customArgs = positional.slice(1);
       } catch {
       console.error(chalk.red(`Custom command not found: /${commandName}`));
       process.exit(1);
     }
    }
  }

  const registry = new ToolRegistry();
  registry.register(ReadTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(EditTool);
  registry.register(GrepTool);
  registry.register(WriteTool);
  registry.register(ApplyPatchTool);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.listSessions) {
    await listSessions();
    process.exit(0);
  } else if (options.showSessionId) {
    if (!options.showSessionId) {
      console.error(chalk.red("Please provide a session ID to show. Usage: z-code --show-session <id>"));
      process.exit(1);
    }
    await showSession(options.showSessionId);
    process.exit(0);
  } else if (options.deleteSessionId) {
    if (!options.deleteSessionId) {
      console.error(chalk.red("Please provide a session ID to delete. Usage: z-code --delete-session <id>"));
      process.exit(1);
    }
    await deleteSession(options.deleteSessionId);
    process.exit(0);
  } else if (options.deleteAllSessions) {
    await deleteAllSessions();
    process.exit(0);
  } else if (options.listCommands) {
    try {
      const entries = await fs.readdir(path.join(__dirname, COMMANDS_DIR));
      const commandsFiles = entries.filter(f => f.endsWith(".md"));
      
      if (commandsFiles.length === 0) {
        console.log("No custom commands found in " + COMMANDS_DIR);
      } else {
        console.log(chalk.bold("\nAvailable Custom Commands:"));
        console.log("--------------------------------------------------------------------------------");
        for (const file of commandsFiles) {
          const { metadata } = await loadPrompt(path.join(__dirname, COMMANDS_DIR, file));
          const cmdName = file.replace(".md", "");
          const description = metadata.description || "No description";
          console.log(`${chalk.cyan(cmdName).padEnd(20)} ${description}`);
          if (metadata.arguments && metadata.arguments.length > 0) {
            const argsStr = metadata.arguments
              .map((arg: any) => `${chalk.gray(arg.name)}: ${arg.description || "no description"}`)
              .join(", ");
            console.log(`  ${chalk.gray("Args:")} ${argsStr}`);
          }
        }
        console.log("--------------------------------------------------------------------------------\n");
      }
      process.exit(0);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        console.log("Commands directory not found: " + COMMANDS_DIR);
      } else {
        console.error(chalk.red(`Error listing commands: ${e.message}`));
      }
      process.exit(1);
    }
  }

  if (options.continueSession && !options.sessionId) {
    try {
      const entries = await fs.readdir(SESSION_ROOT);
      if (entries.length > 0) {
        const sessionData = await Promise.all(
          entries.map(async (id) => {
            const stats = await fs.stat(path.join(SESSION_ROOT, id));
            return { id, mtime: stats.mtime };
          })
        );
        sessionData.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        options.sessionId = sessionData[0].id;
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error(chalk.red(`Error finding last session: ${e.message}`));
        process.exit(1);
      }
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY environment variable");
    process.exit(1);
  }

  const ai = new GoogleGenAI({
    apiKey: apiKey,
  });

  const tools: any[] = [{
    functionDeclarations: registry.listTools().map(t => ({
      name: t.id,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters as any),
    }))
  }];

  const sessionId = options.sessionId || crypto.randomUUID();
  if (options.fork) {
    if (!options.sessionId) {
      console.error(chalk.red("The -f/--fork flag requires a session ID provided via -s/--session."));
      process.exit(1);
    }
    await spawnSession(options.sessionId, options.promptPath);
  }
  console.log(chalk.gray(`Session ID: ${sessionId}`));
  const sessionDir = path.join(SESSION_ROOT, sessionId);
  const toolDescriptions = registry.listTools()
    .map(t => `${t.id}: ${t.description}`)
    .join("\n");

  let systemPrompt: string;
  let userQuery = "";
  let pipedData = "";

  if (!process.stdin.isTTY) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      pipedData = Buffer.concat(chunks).toString("utf8");
    } catch (e) {
      // ignore
    }
  }

  if (options.customCommand) {
    const cmdName = options.customCommand;
    const cmdPath = path.join(__dirname, COMMANDS_DIR, `${cmdName}.md`);
    const { metadata: cmdMetadata, body: cmdBody } = await loadPrompt(cmdPath);
    
    const agentName = cmdMetadata.agent || "default";
    const cmdArgsDef = cmdMetadata.arguments || [];
    
    const agentPath = agentName === "default" 
      ? (options.promptPath.startsWith("/") || path.isAbsolute(options.promptPath) ? options.promptPath : path.join(__dirname, options.promptPath))
      : path.join(__dirname, `prompts/${agentName}.md`);
    
    const { metadata: agentMetadata, body: agentBody } = await loadPrompt(agentPath);
    const agentArgsDef = agentMetadata.arguments || [];
    
    const nAgent = agentArgsDef.length;
    const nCmd = cmdArgsDef.length;
    
    const agentArgs = positional.slice(1, 1 + nAgent);
    const cmdArgs = positional.slice(1 + nAgent, 1 + nAgent + nCmd);
    const queryPart = positional.slice(1 + nAgent + nCmd).join(" ");
    
    const agentsMdContent = await loadAgentsMd();
    systemPrompt = `${expandTemplate(agentBody, agentArgs, agentArgsDef)}${agentsMdContent}\n\nAvailable Tools:\n${toolDescriptions}`;
    userQuery = `${expandTemplate(cmdBody, cmdArgs, cmdArgsDef)}\n\n${queryPart}`.trim();
    if (pipedData) {
      userQuery += `\n\n${pipedData}`;
    }
    
    if (options.dryRun) {
      console.log(chalk.bold("\nSystem Prompt:"));
      console.log(systemPrompt);
      console.log("\n" + chalk.bold("User Prompt:"));
      console.log(userQuery);
      process.exit(0);
    }
  } else {
    const promptPath = options.promptPath.startsWith("/") || path.isAbsolute(options.promptPath)
      ? options.promptPath
      : path.join(__dirname, options.promptPath);
    
    const { metadata: defaultMetadata, body: defaultBody } = await loadPrompt(promptPath);
    
    const agentsMdContent = await loadAgentsMd();
    systemPrompt = `${expandTemplate(defaultBody, [], defaultMetadata.arguments)}${agentsMdContent}\n\nAvailable Tools:\n${toolDescriptions}`;
    
    if (pipedData) {
      userQuery = pipedData + (positional.length > 0 ? "\n\n" + positional.join(" ") : "");
    }
    if (!userQuery) {
      userQuery = positional.join(" ");
    }
  }

  if (!userQuery) {
    if (options.continueSession && options.sessionId) {
      const sessionDir = path.join(SESSION_ROOT, options.sessionId);
      try {
        const historyData = await fs.readFile(path.join(sessionDir, "history.json"), "utf8");
        const messages = JSON.parse(historyData);
        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
           if (lastMessage.role === "user" && lastMessage.parts.some((p: any) => p.functionResponse)) {
            userQuery = "[System: The previous session was interrupted after a tool response. Please continue your analysis and provide the final response.]";
          } else {
            userQuery = "[System: Please continue the conversation from where it was interrupted.]";
          }
        }
      } catch (e) {
        // ignore, fallback to error if no history
      }
    }

    if (!userQuery) {
      console.error("Please provide a query as a command line argument or via stdin");
      process.exit(1);
    }
  }

  if (options.sessionId) {
    try {
      systemPrompt = await fs.readFile(path.join(sessionDir, "system_prompt.txt"), "utf8");
    } catch (e) {
      console.error(chalk.red(`Session ${sessionId} not found or missing system prompt`));
      process.exit(1);
    }
  } else {
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "system_prompt.txt"), systemPrompt);
  }

  let messages: any[] = [];
  if (options.sessionId) {
    try {
      const historyData = await fs.readFile(path.join(sessionDir, "history.json"), "utf8");
      messages = JSON.parse(historyData);
    } catch (e) {
      // ignore
    }
  }
  messages.push({ role: "user", parts: [{ text: userQuery }] });

  const ctx: ToolContext = {
    sessionID: sessionId,
    messageID: crypto.randomUUID(),
    agent: "assistant",
  };

  let totalPromptTokens = 0;
  let totalCandidatesTokens = 0;
  let totalTokens = 0;

  while (true) {
    let response;
    let retries = 0;
    const maxRetries = 3;

    while (true) {
      let thinkingSpinner;
      try {
        if (options.verbosity === 0 || options.verbosity >= 2) {
          thinkingSpinner = ora("Thinking...").start();
        }
        response = await ai.models.generateContent({
          model: options.model,
          contents: messages,
          config: {
            tools: tools,
            systemInstruction: { parts: [{ text: systemPrompt }] }
          }
        });
        if (thinkingSpinner) thinkingSpinner.stop();
        if (response.usageMetadata) {
          totalPromptTokens += response.usageMetadata.promptTokenCount || 0;
          totalCandidatesTokens += response.usageMetadata.candidatesTokenCount || 0;
          totalTokens += response.usageMetadata.totalTokenCount || 0;
        }
        break;
      } catch (e: any) {
        if (thinkingSpinner) thinkingSpinner.fail("Thinking failed");

        if (e.status && retries < maxRetries) {
          retries++;
          console.log(chalk.yellow(`API Error ${e.status}, retrying in 3s... (${retries}/${maxRetries})`));
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        if (e.status) {
          try {
            const parsed = JSON.parse(e.message);
            console.error(chalk.red(`API Error ${parsed.error.code}: ${parsed.error.message}`));
          } catch {
            console.error(chalk.red(`API Error ${e.status}: ${e.message}`));
          }
        } else {
          console.error(chalk.red(`Error: ${e.message}`));
        }
        process.exit(1);
      }
    }

    const message = response.candidates![0].content!;
    messages.push(message);
    await fs.writeFile(path.join(sessionDir, "history.json"), JSON.stringify(messages, null, 2));

    const toolCalls = response.functionCalls || [];

    for (const part of message.parts || []) {
      if (part.text) {
        if (toolCalls.length === 0 && !part.thought) {
          finalOutputBuffer += part.text + "\n";
        }
        if (part.thought) {
          if (options.verbosity > 0) {
            console.log(chalk.gray(part.text));
          }
        } else if (toolCalls.length > 0) {
          console.log(chalk.yellow(part.text));
        } else {
          console.log(part.text);
        }
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    const functionResponseParts: any[] = [];

    for (const toolCall of toolCalls) {
      const toolId = toolCall.name!;
      const args = toolCall.args || {};
      
      const spinner = ora(`Executing ${chalk.cyan(toolId)}...`).start();
      try {
        const result = await registry.execute(toolId, args as any, ctx);
        if (spinner) spinner.succeed(`Executed ${chalk.cyan(toolId)}`);
        if (options.verbosity > 1) {
          console.log(chalk.blue(`${result.output.substring(0, 500)}${result.output.length > 500 ? "..." : ""}`));
        }
        
        functionResponseParts.push({
          functionResponse: {
            name: toolId,
            response: { output: result.output }
          }
        });
      } catch (e: any) {
        if (spinner) spinner.fail(`Error executing ${chalk.cyan(toolId)}`);
        if (options.verbosity > 1) {
          console.log(chalk.red(`Error: ${e.message}`));
        }
        
        functionResponseParts.push({
          functionResponse: {
            name: toolId,
            response: { error: e.message }
          }
        });
      }
    }

    if (functionResponseParts.length > 0) {
      messages.push({
        role: "user",
        parts: functionResponseParts,
      });
      await fs.writeFile(path.join(sessionDir, "history.json"), JSON.stringify(messages, null, 2));
    }
  }

  if (options.output) {
    await fs.writeFile(options.output, finalOutputBuffer, "utf8");
    console.log(chalk.green(`\nOutput saved to ${options.output}`));
  }
 
  console.log(chalk.gray(`\nTokens: Prompt: ${totalPromptTokens}, Candidates: ${totalCandidatesTokens}, Total: ${totalTokens}`));
}

main().catch(console.error);
