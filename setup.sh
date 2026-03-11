#!/bin/bash

# setup.sh - Activate local-tools on a new machine

echo "🚀 Starting local-tools setup..."

# 1. Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed. Please install it first."
    exit 1
fi

# 2. Install dependencies
echo "📦 Installing npm dependencies..."
npm install

# 3. Add bin to PATH in .bashrc or .zshrc
BIN_PATH="$(pwd)/bin"
SHELL_CONFIG=""

if [[ "$SHELL" == */zsh ]]; then
    SHELL_CONFIG="$HOME/.zshrc"
elif [[ "$SHELL" == */bash ]]; then
    SHELL_CONFIG="$HOME/.bashrc"
else
    SHELL_CONFIG="$HOME/.profile"
fi

if ! grep -q "$BIN_PATH" "$SHELL_CONFIG"; then
    echo "🔗 Adding $BIN_PATH to PATH in $SHELL_CONFIG..."
    echo "export PATH=\"\$PATH:$BIN_PATH\"" >> "$SHELL_CONFIG"
else
    echo "✅ $BIN_PATH is already in your PATH."
fi

# 4. Handle .env file in home directory
ENV_FILE="$HOME/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "🔑 Creating a template .env file in $HOME..."
    echo "GEMINI_API_KEY=your_gemini_api_key_here" > "$ENV_FILE"
    echo "⚠️  Action Required: Update $ENV_FILE with your actual Gemini API key."
elif ! grep -q "GEMINI_API_KEY" "$ENV_FILE"; then
    echo "GEMINI_API_KEY=your_gemini_api_key_here" >> "$ENV_FILE"
    echo "⚠️  Action Required: Add your Gemini API key to $ENV_FILE."
else
    echo "✅ GEMINI_API_KEY found in $ENV_FILE."
fi

# 5. Make binaries executable
chmod +x bin/*

echo "------------------------------------------------"
echo "🎉 Setup complete!"
echo "👉 Run: source $SHELL_CONFIG"
echo "👉 Then try: my-tool Hello World!"
echo "------------------------------------------------"
