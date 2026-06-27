#!/usr/bin/env bash
set -euo pipefail

ROOT="${2:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
TARGET="${1:-src}"

cd "$ROOT"

if [[ "$TARGET" == /* || "$TARGET" == *".."* ]]; then
  echo "Target must be a workspace-relative path" >&2
  exit 2
fi

if [[ ! -e "$TARGET" ]]; then
  echo "Target not found: $TARGET" >&2
  exit 2
fi

if [[ -x node_modules/.bin/eslint ]]; then
  ESLINT=(node_modules/.bin/eslint)
else
  ESLINT=(npx --yes eslint)
fi

"${ESLINT[@]}" --no-eslintrc --no-error-on-unmatched-pattern "$TARGET"
