# local-tools

`local-tools` is a collection of personal command-line interface (CLI) utilities built with Node.js. These tools are designed to be globally accessible from your terminal and often leverage external Large Language Model (LLM) APIs, specifically Google Gemini, for enhanced functionality.

## Project Overview

This repository provides various CLI tools to streamline development workflows. Key features include:
- **LLM-powered utilities:** Tools like `z-git-commit` automate tasks using Gemini API.
- **Global accessibility:** Scripts are designed to be linked globally for easy access from any terminal session.
- **Centralized configuration:** All environment-specific configurations are managed via a `~/.env` file.

## Installation

Follow these steps to set up and install the `local-tools` on your system.

### 1. Clone the Repository

First, clone this repository to your local machine:

```bash
git clone https://github.com/your-username/local-tools.git
cd local-tools
```

### 2. Run the Setup Script

A `setup.sh` script is provided to automate the installation process. This script will:
- Run `npm link` to globally link the project's executable scripts.
- Create a symbolic link for the `.z-gems` directory in your home folder, making personal LLM templates easily accessible.

```bash
chmod +x setup.sh
./setup.sh
```

### 3. Configure Environment Variables

The tools require certain environment variables, primarily your `GEMINI_API_KEY`. Create a `.env` file in your home directory (`~/.env`) with the necessary variables.

```bash
# ~/.env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
GEMINI_MODEL="gemini-2.0-flash" # Optional: default model
```

Replace `"YOUR_GEMINI_API_KEY"` with your actual Gemini API key.

## Usage

Once installed and configured, you can use the tools directly from your terminal. For example, to generate a git commit message using the LLM-powered `z-git-commit` tool:

```bash
git diff | z-git-commit
```

Refer to the individual tool scripts in the `bin/` directory for specific usage instructions and options.
