# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Tasks

- **Installation & Setup**: Run `./setup.sh` to globally link executable scripts and set up the `.z-gems` directory.
- **Environment Configuration**: All configuration and secrets (e.g., `GEMINI_API_KEY`, `GROQ_API_KEY`) must be stored in `~/.env`.
- **Adding New Tools**: 
  - Place executable scripts in the `bin/` directory.
  - Scripts must have no file extension.
  - Include `#!/usr/bin/env node` shebang and ensure the file is executable (`chmod +x`).
  - Register the binary in `package.json` under the `bin` field for global linking.

## High-Level Architecture

The project is a collection of Node.js (CommonJS) CLI utilities designed for global accessibility.

- **Binaries (`bin/`)**: Contains the primary executable tools.
  - `z-gem`, `z-gem-groq`, `z-gem-ollama`: Versatile LLM-powered tools that use templates (gems) for different tasks. They support both piped input mode and interactive console mode.
  - `z-list-gemini-models`: Utility to list available Gemini models.
- **Skills (`skills/`)**: A directory containing specialized prompt templates/definitions (gems) for various roles (e.g., `git-expert`, `linux-kernel-expert`).
- **Configuration**: Centralized in `~/.env` using `dotenv` to avoid storing secrets in the repository.
- **Dependencies**: Minimal set, primarily `@google/generative-ai` and `dotenv`.

## Core Mandates

- **Configuration Path**: Mandatory use of `~/.env` for all environment variables.
- **Binary Requirements**: No extensions in `bin/`, must use Node.js shebang.
