import chalk from "chalk";
import { Command } from "commander";

export interface CliOptions {
  verbosity: number;
  model: string | null;
  promptPath: string;
  sessionId: string | null;
  continueSession: boolean;
  fork: boolean;
  dryRun: boolean;
  output: string | null;
  listSessions: boolean;
  showSessionId: string | null;
  deleteSessionId: string | null;
  deleteAllSessions: boolean;
  listCommands: boolean;
  listSkills: boolean;
  skills: string[];
  help?: boolean;
  customCommand?: string;
  customArgs?: string[];
}

export function createProgram() {
  const program = new Command();

  program
    .name("z-code")
    .description("AI-powered coding assistant")
    .version("1.0.0")
    .arguments('[query...]');

  program
    .option("-v, --verbosity [level]", "Set verbosity level (0: thinking and tool progress, 1: tool progress, 2: tool output)", (value, prev) => {
      if (value === undefined) return 1;
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? 1 : parsed;
    }, 0)
    .option("-m, --model <model>", "Specify the Gemini model (default: GEMINI_MODEL env var or gemini-2.5-flash)")
    .option("-p, --prompt-path <path>", "Specify a custom system prompt file", (value) => value, "prompts/default.md")
    .option("-s, --session-id <id>", "Resume a session with the given ID")
    .option("-f, --fork", "Pre-spawn the session with the system prompt")
    .option("-o, --output <path>", "Save the final cleaned output to a file")
    .option("-c, --continue-session", "Resume the last session or create a new one")
    .option("-k, --skills <skill>", "Enable a specific skill (can be used multiple times)", (value: string, prev: string[]) => {
      return prev ? [...prev, value] : [value];
    }, [] as string[])
    .option("--dry-run", "Show expanded prompt for custom commands without executing")
    .option("--list-sessions", "List all sessions")
    .option("--show-session-id <id>", "Show history of a specific session")
    .option("--delete-session-id <id>", "Delete a specific session")
    .option("--delete-all-sessions", "Delete all sessions")
    .option("--list-commands", "List available custom command templates")
    .option("--list-skills", "List available skills");

  return program;
}
