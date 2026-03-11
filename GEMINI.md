# GEMINI.md - Project Context & Mandates

## Project Overview
`local-tools` is a Node.js-based repository for personal CLI utilities. The tools are designed to be globally accessible from the terminal and often interact with external LLM APIs (specifically Google Gemini).

## Core Mandates & Rules
1. **Tool Location:** All executable scripts MUST be placed in the `bin/` directory and have no file extension (e.g., `bin/my-tool` instead of `bin/my-tool.js`).
2. **Execution:** All scripts MUST include a `#!/usr/bin/env node` shebang and be marked as executable (`chmod +x`).
3. **Environment Configuration:**
   - **DO NOT** use a local `.env` file within the project directory.
   - **MANDATORY:** All secrets (like `GEMINI_API_KEY`) MUST be loaded from `~/.env` (the user's home directory).
   - Use the pattern: `require("dotenv").config({ path: path.join(require("os").homedir(), ".env") });`
4. **Dependencies:** Maintain a minimal footprint. Use `@google/generative-ai` for LLM interactions and `dotenv` for configuration.
5. **Standard Formatting:** `z-git-commit` must strictly follow the Conventional Commits format with a 50-character limit for the subject line.

## Key Files
- `bin/z-git-commit`: LLM-powered git commit message generator using Gemini API. Reads diff from stdin.
- `bin/my-tool`: Template/example tool for testing path connectivity.
- `setup.sh`: Automation script for configuring `PATH` and installing dependencies on new machines.

## Architecture
- **Language:** Node.js (CommonJS).
- **PATH Integration:** The project assumes `export PATH="$PATH:/absolute/path/to/local-tools/bin"` is present in the user's shell configuration (`.bashrc` or `.zshrc`).
