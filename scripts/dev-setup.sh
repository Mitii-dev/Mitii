#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

editor="${THUNDER_EDITOR:-vscode}"

echo "Installing dependencies..."
pnpm install

echo "Compiling extension and webview..."
pnpm run compile

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "Rebuilding native modules for ${editor}..."
  THUNDER_EDITOR="${editor}" pnpm run rebuild:native
else
  cat <<'NOTE'
Skipping Electron native rebuild auto-detection on this OS.
Set THUNDER_ELECTRON_VERSION for your editor, then run:
  THUNDER_ELECTRON_VERSION=<electron-version> pnpm run rebuild:native
NOTE
fi

echo "Rebuilding native modules for local Node tests..."
pnpm run rebuild:node

echo "Setup complete. Press F5 in VS Code to launch the Extension Development Host."
