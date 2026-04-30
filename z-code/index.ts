#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import chalk from "chalk";
import ora from "ora";

import { ToolRegistry, ReadTool, BashTool, GlobTool, EditTool, GrepTool, WriteTool, ApplyPatchTool, LoadSkillTool, ToolContext } from "./packages/tools/index.js";
import { loadConfig, CONFIG_PATH } from "./packages/core/config.js";
import { parseArgs, printHelp } from "./packages/core/cli.js";
import { loadPrompt, resolvePromptPath, assembleSystemPrompt, expandTemplate, listSkills } from "./packages/core/prompt.js";
import { listSessions, deleteSession, deleteAllSessions, showSession, spawnSession, SESSION_ROOT } from "./packages/core/session.js";
import { AiClient } from "./packages/core/ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = "prompts/commands";

async function main() {
  const config = await loadConfig();
  const { options, positional } = parseArgs(process.argv.slice(2));

  const registry = new ToolRegistry();
  registry.register(ReadTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(EditTool);
  registry.register(GrepTool);
  registry.register(WriteTool);
  registry.register(ApplyPatchTool);
  registry.register(LoadSkillTool);


  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, async () => {
      await registry.killAllChildren();
      console.log(chalk.yellow(`\n\n🛑 Session interrupted by ${signal}`));
      console.log(chalk.gray("You can resume this conversation with: z-code -c"));
      process.exit(0);
    });
  });

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.listSessions) {
    await listSessions();
    process.exit(0);
  } else if (options.showSessionId) {
    await showSession(options.showSessionId);
    process.exit(0);
  } else if (options.deleteSessionId) {
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
      console.error(chalk.red(`Error listing commands: ${e.message}`));
      process.exit(1);
    }
  } else if (options.listSkills) {
    try {
      const skills = await listSkills();
      if (skills.length === 0) {
        console.log("No skills found in project or global config.");
      } else {
        console.log(chalk.bold("\nAvailable Skills:"));
        console.log("--------------------------------------------------------------------------------");
        for (const skill of skills) {
          console.log(`${chalk.cyan(skill.name).padEnd(20)} ${skill.description || "No description"}`);
        }
        console.log("--------------------------------------------------------------------------------\n");
      }
      process.exit(0);
    } catch (e: any) {
      console.error(chalk.red(`Error listing skills: ${e.message}`));
      process.exit(1);
    }
  }

  // Custom command detection
  if (positional.length > 0 && positional[0].startsWith("/")) {
    const commandName = positional[0].slice(1);
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

  // Tool filtering
  let allowedTools: string[] | null = null;
  if (options.customCommand) {
    const cmdPath = path.join(__dirname, COMMANDS_DIR, `${options.customCommand}.md`);
    const { metadata } = await loadPrompt(cmdPath);
    if (metadata.tool) {
      allowedTools = Array.isArray(metadata.tool) ? metadata.tool : [metadata.tool];
    }
  }

  const activeTools = registry.filterTools(allowedTools);
  const toolDeclarations = [{
    functionDeclarations: activeTools.map(t => ({
      name: t.id,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters as any),
    }))
  }];

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

  const apiKey = config.gemini_api_key;
  if (!apiKey) {
    console.error(`Missing Gemini API key. Please add it to ${CONFIG_PATH}`);
    process.exit(1);
  }

  const model = options.model || config.gemini_model || "gemini-2.5-flash";
  const aiClient = new AiClient(apiKey, model);

  const sessionId = options.sessionId || crypto.randomUUID();
  if (options.fork) {
    if (!options.sessionId) {
      console.error(chalk.red("The -f/--fork flag requires a session ID provided via -s/--session."));
      process.exit(1);
    }
    await spawnSession(options.sessionId, options, registry, options.promptPath);
  }
  console.log(chalk.gray(`Session ID: ${sessionId}`));
  const sessionDir = path.join(SESSION_ROOT, sessionId);

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
      ? resolvePromptPath(options.promptPath, __dirname)
      : path.join(__dirname, `prompts/${agentName}.md`);
    
    const { metadata: agentMetadata, body: agentBody } = await loadPrompt(agentPath);
    const agentArgsDef = agentMetadata.arguments || [];
    
    const nAgent = agentArgsDef.length;
    const nCmd = cmdArgsDef.length;
    
    const agentArgs = positional.slice(1, 1 + nAgent);
    const cmdArgs = positional.slice(1 + nAgent, 1 + nAgent + nCmd);
    const queryPart = positional.slice(1 + nAgent + nCmd).join(" ");
    
    systemPrompt = await assembleSystemPrompt(options, registry, { metadata: agentMetadata, body: agentBody }, agentArgs, allowedTools);
    userQuery = `${expandTemplate(cmdBody, cmdArgs, cmdArgsDef)}\n\n${queryPart}`.trim();
  } else {
    const promptPath = resolvePromptPath(options.promptPath, __dirname);
    const { metadata: defaultMetadata, body: defaultBody } = await loadPrompt(promptPath);
    systemPrompt = await assembleSystemPrompt(options, registry, { metadata: defaultMetadata, body: defaultBody }, [], allowedTools);
    
    if (pipedData) {
      userQuery = pipedData + (positional.length > 0 ? "\n\n" + positional.join(" ") : "");
    }
    if (!userQuery) {
      userQuery = positional.join(" ");
    }
  }
  
  if (pipedData && !options.customCommand) {
    // handled already
  } else if (pipedData && options.customCommand) {
    userQuery += `\n\n${pipedData}`;
  }

  if (options.dryRun) {
    console.log(chalk.bold("\nSystem Prompt:"));
    console.log(systemPrompt);
    console.log("\n" + chalk.bold("User Prompt:"));
    console.log(userQuery);
    process.exit(0);
  }

  if (!userQuery) {
    if (options.continueSession && options.sessionId) {
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
        // ignore
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
    extra: {
      registry,
    },
  };

  const { finalOutput, tokens } = await aiClient.generateResponse(
    messages,
    systemPrompt,
    toolDeclarations,
    options,
    ctx,
    sessionDir,
    registry,
    (text) => {
      // Optional: handle streaming-like behavior if needed
    }
  );

  if (options.output) {
    await fs.writeFile(options.output, finalOutput, "utf8");
    console.log(chalk.green(`\nOutput saved to ${options.output}`));
  }
  
  console.log(chalk.gray(`\nTokens: Prompt: ${tokens.prompt}, Candidates: ${tokens.candidates}, Total: ${tokens.total}`));
}

main().catch(console.error);
