#!/usr/bin/env bash
# Read-only HTTP probe for Mitii api-db-runtime-debug.
# Usage: probe-api.sh <url> [header...]
# Env: PROBE_BEARER (optional Authorization Bearer token)
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <url> [curl -H args...]" >&2
  exit 2
fi

URL="$1"
shift

AUTH_ARGS=()
if [[ -n "${PROBE_BEARER:-}" ]]; then
  AUTH_ARGS=(-H "Authorization: Bearer ${PROBE_BEARER}")
fi

curl -sS -D - -o /tmp/mitii-probe-api-body.$$ "${AUTH_ARGS[@]}" "$@" "$URL"
echo
echo "----- body -----"
head -c 8000 /tmp/mitii-probe-api-body.$$ || true
echo
rm -f /tmp/mitii-probe-api-body.$$
