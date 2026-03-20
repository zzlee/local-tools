# local-tools

`local-tools` is a collection of personal command-line interface (CLI) utilities built with Node.js. These tools are designed to be globally accessible from your terminal and often leverage external Large Language Model (LLM) APIs, specifically Google Gemini, for enhanced functionality.

## Project Overview

This repository provides various CLI tools to streamline development workflows. Key features include:
- **LLM-powered utilities:** `z-gem` allows for the creation and use of personal LLM-powered tools that automate tasks using the Gemini API.
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

Once installed and configured, you can use the tools directly from your terminal. The `z-gem` tool now supports two distinct modes of operation:

### 1. Piped Input Mode (for single-turn requests)

This mode is ideal for processing output from other commands, where the entire input is sent to the LLM at once.

**Example: Generate a Git Commit Message**
To generate a git commit message based on your staged changes using the `git-commit` gem:

```bash
git diff | z-gem ~/.z-gems/git-commit
```
*(Note: Replace `~/.z-gems/git-commit` with the actual absolute path to your gem if it's not in the default location.)*

### 2. Interactive Console Mode (for multi-turn conversations)

This mode allows for a multi-turn conversation with the LLM. If `z-gem` detects that it's running in an interactive terminal (i.e., not receiving piped input), it will automatically enter this mode.

**Example: Chat with the `tech-english-teacher` gem**
To start an interactive session with the `tech-english-teacher` gem (the default if no gem path is provided):

```bash
z-gem
```

You can also specify a different gem:

```bash
z-gem ~/.z-gems/your-custom-chat-gem
```

In interactive mode:
- Type your message and press Enter.
- The LLM's response will be displayed.
- Type `exit` or `quit` (and press Enter) to end the session.

You can find your installed gems in the `.z-gems/` directory in your home folder. Refer to the individual gem scripts for specific usage instructions and options.
