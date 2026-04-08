# GEMINI.md - Project Context & Mandates

## Project Overview
`local-tools` is a Node.js-based repository for personal CLI utilities. The tools are designed to be globally accessible from the terminal and often interact with external LLM APIs (specifically Google Gemini).

## Core Mandates & Rules
1. **Tool Location:** All executable scripts MUST be placed in the `bin/` directory and have no file extension (e.g., `bin/my-tool` instead of `bin/my-tool.js`).
2. **Execution:** All scripts MUST include a `#!/usr/bin/env node` shebang and be marked as executable (`chmod +x`).
3. **Environment Configuration:**
   - **DO NOT** use a local `.env` file within the project directory.
   - **MANDATORY:** All configuration MUST be loaded from `~/.env` (the user's home directory).
   - **Required Secrets:** `GEMINI_API_KEY`.
   - **Optional Settings:** `GEMINI_MODEL` (defaults to `gemini-2.0-flash`).
   - Use the pattern: `require("dotenv").config({ path: path.join(require("os").homedir(), ".env") });`
4. **Dependencies:** Maintain a minimal footprint. Use `@google/generative-ai` for LLM interactions and `dotenv` for configuration.

## Key Files
- `bin/z-list-gemini-models`: Utility to list all available Gemini models for the current API key.
- `bin/z-gem`: LLM-powered tool that generates content based on a customizable template using Gemini API.
- `bin/z-gem-groq`: LLM-powered tool that generates content based on a customizable template using Groq API.
- `bin/z-gem-ollama`: LLM-powered tool that generates content based on a customizable template using Ollama API.

- `setup.sh`: Automation script for configuring `PATH` and installing dependencies on new machines.

## Architecture
- **Language:** Node.js (CommonJS).
- **PATH Integration:** The project assumes `export PATH="$PATH:/absolute/path/to/local-tools/bin"` is present in the user's shell configuration (`.bashrc` or `.zshrc`).
