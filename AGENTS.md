# Agents Guide: local-tools

A collection of Node.js CLI utilities. Many leverage LLMs via Gemini and Groq.

## Developer Commands
- **Build `z-code`**: `npm run build` (Required after modifying `z-code/*.ts` before the global binary updates)
- **Test `z-code` locally**: `npm run z-code -- [args]`
- **Full Setup**: `./setup.sh` (Runs `npm install`, `npm run build`, `npm link`, and symlinks `.z-gems` to `~/.z-gems`)

## Architecture & Configuration
- **Global Config**: Tools read environment variables from `~/.env` (e.g., `GEMINI_API_KEY`, `GROQ_API_KEY`).
- **`z-code` Tool**:
  - **Source**: TypeScript in `z-code/` folder.
  - **Build Output**: Compiled to `z-code/dist/index.js`.
  - **Session Storage**: Local history stored in `.z-code/sessions/` (relative to CWD).
  - **Custom Commands**: Templates located in `z-code/prompts/commands/*.md`.
- **Gems**: Simple prompt templates stored in `.z-gems/` (symlinked to `~/.z-gems`).

## `z-code` Specifics
- **Custom Command Syntax**: Use `/<command_name> [args]` (e.g., `z-code /review "code"`).
- **Admin Options**:
  - `--list-sessions`, `--show-session <id>`, `--delete-session <id>`, `--delete-all-sessions`
  - `--list-commands`
- **Session Management**: 
  - `-s <id>` resumes a session.
  - `-c` resumes the most recent session.
  - `-f` pre-spawns a session with a system prompt.

## Conventions
- **Binaries**: Most tools are simple scripts in `bin/`. `z-code` is the only one requiring a build step.
- **LLM Integration**: Uses `@google/generative-ai` and `ollama` for model interactions.
