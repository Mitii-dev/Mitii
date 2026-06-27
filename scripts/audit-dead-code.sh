#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

if [[ ! -f package.json ]]; then
  echo "No package.json found in $ROOT" >&2
  exit 2
fi

if [[ -x node_modules/.bin/knip ]]; then
  exec node_modules/.bin/knip --reporter json --no-progress
fi

exec npx --yes knip --reporter json --no-progress
