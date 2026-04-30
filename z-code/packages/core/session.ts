import * as fs from "node:fs/promises";
import * as path from "node:path";
import chalk from "chalk";
import { ToolRegistry } from "../tools/registry.js";
import { loadPrompt, loadAgentsMd, loadSkill, expandTemplate, assembleSystemPrompt } from "./prompt.js";

export const SESSION_ROOT = path.join(process.cwd(), ".z-code", "sessions");

export async function listSessions() {
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

export async function deleteSession(id: string) {
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

export async function deleteAllSessions() {
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

export async function showSession(id: string) {
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

export async function spawnSession(id: string, options: any, registry: ToolRegistry, promptPath?: string) {
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

  // We need to resolve the prompt path
  // Note: For simplicity in this extracted module, I'm passing options and registry
  // But ideally we use the prompt module for resolution
  const resolvedPromptPath = promptPath 
    ? (promptPath.startsWith("/") || path.isAbsolute(promptPath) ? promptPath : path.join(process.cwd(), promptPath))
    : (options.promptPath.startsWith("/") || path.isAbsolute(options.promptPath) ? options.promptPath : path.join(process.cwd(), options.promptPath));

  try {
    const { metadata, body } = await loadPrompt(resolvedPromptPath);
    
    const allowedTools = metadata.tool;
    const activeTools = registry.listTools().filter(t => {
      if (!allowedTools) return true;
      const toolsList = Array.isArray(allowedTools) ? allowedTools : [allowedTools];
      if (toolsList.includes('*')) return true;
      return toolsList.includes(t.id);
    });

    const toolDescriptions = activeTools
      .map(t => `${t.id}: ${t.description}`)
      .join("\n");
      
    const toolsSection = toolDescriptions ? `\n\nAvailable Tools:\n${toolDescriptions}` : "";
    
    const systemPrompt = await assembleSystemPrompt(
      options,
      registry,
      { metadata, body },
      [],
      allowedTools
    );

    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "system_prompt.txt"), systemPrompt);
    await fs.writeFile(path.join(sessionDir, "history.json"), "[]");

    console.log(chalk.green(`Session ${id} spawned successfully.`));
  } catch (e: any) {
    console.error(chalk.red(`Error spawning session: ${e.message}`));
    process.exit(1);
  }
}
