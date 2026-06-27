#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

PATTERN='style[[:space:]]*=[[:space:]]*\{[[:space:]]*\{'

set +e
if command -v rg >/dev/null 2>&1; then
  OUTPUT="$(rg -n --hidden "$PATTERN" . \
    --glob '*.{tsx,jsx}' \
    --glob '!node_modules/**' \
    --glob '!dist/**' \
    --glob '!out/**' \
    --glob '!coverage/**' \
    --glob '!scripts/**' \
    --glob '!**/*.test.*' \
    --glob '!**/*.spec.*' \
    --glob '!test/**' \
    --glob '!tests/**')"
  STATUS=$?
else
  OUTPUT="$(grep -RInE "$PATTERN" . \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=out \
    --exclude-dir=coverage \
    --exclude-dir=scripts \
    --include='*.tsx' \
    --include='*.jsx' \
    --exclude='*.test.*' \
    --exclude='*.spec.*')"
  STATUS=$?
fi
set -e

if [[ "$STATUS" -eq 0 ]]; then
  printf '%s\n' "$OUTPUT"
  exit 1
fi

if [[ "$STATUS" -eq 1 ]]; then
  echo "No inline React style object literals found."
  exit 0
fi

printf '%s\n' "$OUTPUT" >&2
exit "$STATUS"
