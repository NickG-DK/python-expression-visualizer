#!/usr/bin/env bash
set -e

echo "=== Python Expression Visualizer — Setup ==="

# Check for Node / npm
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Install from https://nodejs.org (LTS recommended)."
  exit 1
fi

echo "Node $(node -v)  /  npm $(npm -v)"

cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo "Compiling TypeScript..."
npm run compile

echo ""
echo "Done! To run the extension:"
echo "  1. Open this folder in VS Code: code ."
echo "  2. Press F5 to launch the Extension Development Host."
echo "  3. Open any Python file, select an expression, right-click → Visualize Expression."
echo ""
echo "To package as a .vsix for distribution:"
echo "  npm install -g @vscode/vsce && vsce package"
