#!/usr/bin/env node

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as dotenv from "dotenv";
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

function printHelp() {
  console.log(`
Usage: z-code [options] [query]

Options:
  -h, --help                Show this help message
  -v, --verbose [level]     Set verbosity level (0: silent, 1: thoughts, 2: tool output)
  -m, --model <model>       Specify the Gemini model (default: GEMINI_MODEL env var or gemini-2.5-flash)
  -p, --prompt <path>       Specify a custom system prompt file (default: prompts/default.txt)
  -s, --session <id>        Resume a session with the given ID
  -c, --continue              Resume the last session or create a new one
  
Commands:
  session list              List all sessions (newest first)
  session delete <id>       Delete a specific session
  session delete-all        Delete all sessions
  
You can also provide the query via stdin.
`);
}

function parseArgs(args: string[]) {
  const options: any = {
    verbosity: 0,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    promptPath: "prompts/default.txt",
    sessionId: null,
    continueSession: false,
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
    } else if (arg.startsWith("-")) {
      positional.push(arg);
    } else {
      positional.push(arg);
    }
  }

  return { options, positional };
}

async function main() {
  dotenv.config({quiet: true});
  dotenv.config({ path: path.join(os.homedir(), ".env"), quiet: true });
 
  const SESSION_ROOT = path.join(process.cwd(), ".z-code-sessions");
 
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
 
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const { options, positional } = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (positional[0] === "session") {
    const subCommand = positional[1];
    if (subCommand === "list") {
      await listSessions();
      process.exit(0);
    } else if (subCommand === "delete") {
      const id = positional[2];
      if (!id) {
        console.error(chalk.red("Please provide a session ID to delete. Usage: z-code session delete <id>"));
        process.exit(1);
      }
      await deleteSession(id);
      process.exit(0);
    } else if (subCommand === "delete-all") {
      await deleteAllSessions();
      process.exit(0);
    } else {
      console.error(chalk.red(`Unknown session command: ${subCommand}. Use 'list', 'delete <id>', or 'delete-all'.`));
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

  const registry = new ToolRegistry();
  registry.register(ReadTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(EditTool);
  registry.register(GrepTool);
  registry.register(WriteTool);
  registry.register(ApplyPatchTool);

  const tools: any[] = [{
    functionDeclarations: registry.listTools().map(t => ({
      name: t.id,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters as any),
    }))
  }];

  const sessionId = options.sessionId || crypto.randomUUID();
  console.log(chalk.gray(`Session ID: ${sessionId}`));
  const sessionDir = path.join(SESSION_ROOT, sessionId);
  let systemPrompt: string;

  if (options.sessionId) {
    try {
      systemPrompt = await fs.readFile(path.join(sessionDir, "system_prompt.txt"), "utf8");
    } catch (e) {
      console.error(chalk.red(`Session ${sessionId} not found or missing system prompt`));
      process.exit(1);
    }
  } else {
    const promptPath = options.promptPath.startsWith("/") || path.isAbsolute(options.promptPath)
      ? options.promptPath
      : path.join(__dirname, options.promptPath);
    const defaultPrompt = await fs.readFile(promptPath, "utf8");
    const toolDescriptions = registry.listTools()
      .map(t => `${t.id}: ${t.description}`)
      .join("\n");
    systemPrompt = `${defaultPrompt}\n\nAvailable Tools:\n${toolDescriptions}`;
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "system_prompt.txt"), systemPrompt);
  }

  let userQuery = "";
  if (!process.stdin.isTTY) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      const pipedData = Buffer.concat(chunks).toString("utf8");
      if (pipedData) {
        userQuery = pipedData + (positional.length > 0 ? "\n\n" + positional.join(" ") : "");
      }
    } catch (e) {
      // ignore
    }
  }
  if (!userQuery) {
    userQuery = positional.join(" ");
  }
  if (!userQuery) {
    console.error("Please provide a query as a command line argument or via stdin");
    process.exit(1);
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
      try {
        response = await ai.models.generateContent({
          model: options.model,
          contents: messages,
          config: {
            tools: tools,
            systemInstruction: { parts: [{ text: systemPrompt }] }
          }
        });
        if (response.usageMetadata) {
          totalPromptTokens += response.usageMetadata.promptTokenCount || 0;
          totalCandidatesTokens += response.usageMetadata.candidatesTokenCount || 0;
          totalTokens += response.usageMetadata.totalTokenCount || 0;
        }
        break;
      } catch (e: any) {
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

  console.log(chalk.gray(`\nTokens: Prompt: ${totalPromptTokens}, Candidates: ${totalCandidatesTokens}, Total: ${totalTokens}`));
}

main().catch(console.error);
