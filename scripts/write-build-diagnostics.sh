#!/usr/bin/env bash
set -uo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

BUILD_CMD="${THUNDER_BUILD_COMMAND:-pnpm run build}"
TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

bash -c "$BUILD_CMD" > "$TMP_OUTPUT" 2>&1
EXIT_CODE=$?

WORKSPACE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

export THUNDER_DIAG_ROOT="$ROOT"
export THUNDER_DIAG_COMMAND="$BUILD_CMD"
export THUNDER_DIAG_EXIT_CODE="$EXIT_CODE"
export THUNDER_DIAG_OUTPUT_FILE="$TMP_OUTPUT"
export THUNDER_DIAG_TARGET_DIR="$WORKSPACE_ROOT/.mitii/diagnostics"

node <<'NODE'
const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const targetDir = process.env.THUNDER_DIAG_TARGET_DIR;
mkdirSync(targetDir, { recursive: true });

const output = readFileSync(process.env.THUNDER_DIAG_OUTPUT_FILE, 'utf8').slice(0, 200_000);
const payload = {
  savedAt: new Date().toISOString(),
  root: process.env.THUNDER_DIAG_ROOT,
  command: process.env.THUNDER_DIAG_COMMAND,
  exitCode: Number(process.env.THUNDER_DIAG_EXIT_CODE),
  output,
};

const targetFile = join(targetDir, 'current-build-errors.json');
writeFileSync(targetFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${targetFile} (exit ${payload.exitCode})`);
NODE

exit 0
