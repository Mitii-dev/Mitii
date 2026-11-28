#!/usr/bin/env bash
# Migrate one V8 module to flow/ports/adapters/contracts/rules/helpers layout.
set -euo pipefail

MOD_ROOT="${1:?module path required, e.g. src/modules/code-navigation}"
cd "$MOD_ROOT"

mkdir -p flow/steps ports contracts rules helpers adapters

# pipeline → flow
if [[ -d pipeline ]]; then
  shopt -s nullglob
  for f in pipeline/*; do
    mv "$f" flow/
  done
  rmdir pipeline 2>/dev/null || true
fi

# actions → flow/steps
if [[ -d actions ]]; then
  for f in actions/*; do
    base=$(basename "$f")
    mv "$f" "flow/steps/$base"
  done
  rmdir actions 2>/dev/null || true
fi

# policy → rules
if [[ -d policy ]]; then
  for f in policy/*; do
    mv "$f" rules/
  done
  rmdir policy 2>/dev/null || true
elif [[ -f policy.ts ]]; then
  mv policy.ts rules/index.ts
fi

# internal → helpers
if [[ -d internal ]]; then
  for f in internal/*; do
    mv "$f" helpers/
  done
  rmdir internal 2>/dev/null || true
fi

# contracts/ports → ports (keep contracts/ for schemas)
if [[ -d contracts/ports ]]; then
  for f in contracts/ports/*; do
    mv "$f" ports/
  done
  rmdir contracts/ports 2>/dev/null || true
fi

# types → contracts (if a prior layout left types/)
if [[ -d types ]]; then
  mkdir -p contracts
  shopt -s nullglob
  for f in types/*; do
    base=$(basename "$f")
    if [[ -d "$f" ]]; then
      mkdir -p "contracts/$base"
      for inner in "$f"/*; do
        mv "$inner" "contracts/$base/"
      done
      rmdir "$f" 2>/dev/null || true
    else
      mv "$f" "contracts/$base"
    fi
  done
  rmdir types 2>/dev/null || true
fi

# impl → adapters (if a prior layout left impl/)
if [[ -d impl ]]; then
  mkdir -p adapters
  shopt -s nullglob
  for f in impl/*; do
    base=$(basename "$f")
    if [[ -d "$f" ]]; then
      mkdir -p "adapters/$base"
      for inner in "$f"/*; do
        mv "$inner" "adapters/$base/"
      done
      rmdir "$f" 2>/dev/null || true
    else
      mv "$f" "adapters/$base"
    fi
  done
  rmdir impl 2>/dev/null || true
fi

# adapters stay as adapters/; regroup flat prefixed method files if present
if [[ -d adapters ]]; then
  shopt -s nullglob
  for f in adapters/*; do
    [[ -f "$f" ]] || continue
    base=$(basename "$f")
    if [[ "$base" =~ ^(graph|fallback|store|catalog|similarity|hash|echo)-(.+)\.ts$ ]]; then
      kind="${BASH_REMATCH[1]}"
      method="${BASH_REMATCH[2]}"
      mkdir -p "adapters/$kind"
      mv "$f" "adapters/$kind/${method}.ts"
    fi
  done
fi

echo "Migrated folders under $MOD_ROOT"
ls -la
