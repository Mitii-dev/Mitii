#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

editor="${MITII_EDITOR:-${THUNDER_EDITOR:-vscode}}"

echo "Installing dependencies..."
pnpm install

echo "Rebuilding native modules for local Node tests..."
pnpm run rebuild:node

echo "Compiling packages, extension, and webview..."
pnpm run compile

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "Rebuilding + staging native modules for ${editor} (Electron)..."
  MITII_EDITOR="${editor}" pnpm run rebuild:native
else
  cat <<'NOTE'
Skipping Electron native rebuild auto-detection on this OS.
Set MITII_ELECTRON_VERSION for your editor, then run:
  MITII_ELECTRON_VERSION=<electron-version> pnpm run rebuild:native
NOTE
fi

echo "Setup complete. Press F5 in VS Code / Cursor to launch the Extension Development Host."
echo "Code/text indexes need the Electron SQLite binding from rebuild:native (included above on macOS)."
