#!/bin/bash

npm install

# 1. Execute "npm link" to install local tools globally
echo "Running 'npm link' to install local tools..."
npm link

# 2. Create a symbolic link of "./.z-gems/" to the user's home directory
echo "Creating symbolic link for .z-gems to home directory..."
Z_GEMS_SOURCE="$(pwd)/.z-gems"
Z_GEMS_DEST="$HOME/.z-gems"

if [ -L "$Z_GEMS_DEST" ]; then
    echo "Symbolic link already exists: $Z_GEMS_DEST"
elif [ -d "$Z_GEMS_DEST" ]; then
    echo "Directory already exists at $Z_GEMS_DEST. Please remove it manually if you want to create a symbolic link."
else
    ln -s "$Z_GEMS_SOURCE" "$Z_GEMS_DEST"
    echo "Symbolic link created: $Z_GEMS_DEST -> $Z_GEMS_SOURCE"
fi

echo "Setup script finished."
