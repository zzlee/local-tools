import chalk from "chalk";

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
  skills: string[];
  help?: boolean;
  customCommand?: string;
  customArgs?: string[];
}

export function printHelp() {
  console.log(`
Usage: z-code [options] [query]
Or: z-code [options] -- [query]

Options:
  -h, --help                Show this help message
  -v, --verbose [level]     Set verbosity level (0: thinking and tool progress, 1: tool progress, 2: tool output)
  -m, --model <model>       Specify the Gemini model (default: GEMINI_MODEL env var or gemini-2.5-flash)
  -p, --prompt <path>       Specify a custom system prompt file (default: prompts/default.txt)
  -s, --session <id>        Resume a session with the given ID
  -f, --fork                Pre-spawn the session with the system prompt
  -o, --output <path>       Save the final cleaned output to a file
  -c, --continue            Resume the last session or create a new one:
  -k, --skill <skill>        Enable a specific skill (can be used multiple times)
  --dry-run                 Show expanded prompt for custom commands without executing
  --list-sessions           List all sessions
  --show-session <id>       Show history of a specific session
  --delete-session <id>     Delete a specific session
  --delete-all-sessions     Delete all sessions
  --list-commands           List available custom command templates

Note: Use '--' to separate options from the query if your query contains flags.

Custom Commands:
  /<command> [args...]      Use a custom command template (e.g., /review "some text")
                            Templates are located in prompts/commands/

You can also provide the query via stdin.
`);
}

export function parseArgs(args: string[]) {
  const options: any = {
    verbosity: 0,
    model: null,
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
    skills: [] as string[],
  };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }

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
    } else if (arg === "-k" || arg === "--skill") {
      options.skills.push(args[++i]);
    } else if (arg.startsWith("-")) {
      console.error(chalk.red(`\n❌ Error: Unknown flag '${arg}' detected. Use '--' to explicitly mark the start of the query.\n`));
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  return { options: options as CliOptions, positional };
}
