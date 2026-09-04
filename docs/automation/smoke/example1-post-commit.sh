#!/usr/bin/env bash
# Smoke Example 1 — post-commit cover path (schedule + optional echo serve tick).
# With --echo: uses ask/readonly so the echo provider can complete without edits.
# Without --echo: only validates schedule create + trigger queueing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

ECHO=0
for arg in "$@"; do
  if [ "$arg" = "--echo" ]; then ECHO=1; fi
done

DB="$(mktemp "${TMPDIR:-/tmp}/mitii-e2e1.XXXXXX").db"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mitii-e2e1-ws.XXXXXX")"
export MITII_AUTOMATION_DB="$DB"
trap 'rm -f "$DB"; rm -rf "$WORKDIR"' EXIT

mkdir -p "$WORKDIR/src"
printf 'export function add(a: number, b: number) { return a + b; }\n' > "$WORKDIR/src/add.ts"
printf '# smoke workspace\n' > "$WORKDIR/README.md"

echo "==> building CLI + host"
pnpm --filter @mitii/host build >/dev/null
pnpm --filter @mitii/cli build >/dev/null

BIN=(node "$ROOT/apps/cli/bin/mitii.js")

if [ "$ECHO" = "1" ]; then
  MODE=ask
  AUTONOMY=readonly
  PROMPT="Read README.md and reply with one sentence confirming the workspace is ready for post-commit cover automation."
else
  MODE=agent
  AUTONOMY=apply_and_pr
  PROMPT="Inspect latest commit; write missing tests; if green open draft PR via create_pull_request. Never push main."
fi

echo "==> schedule create (mode=$MODE autonomy=$AUTONOMY)"
"${BIN[@]}" schedule create "e2e-post-commit" \
  --cron "0 0 1 1 *" \
  --prompt "$PROMPT" \
  --workspace "$WORKDIR" \
  --mode "$MODE" \
  --autonomy "$AUTONOMY" \
  --json > /tmp/mitii-e2e1-spec.json

SPEC_ID="$(node -e "const j=require('/tmp/mitii-e2e1-spec.json'); console.log(j.specId)")"
echo "spec=$SPEC_ID"

echo "==> trigger"
"${BIN[@]}" schedule trigger "$SPEC_ID" --json > /tmp/mitii-e2e1-run.json
RUN_ID="$(node -e "const j=require('/tmp/mitii-e2e1-run.json'); console.log(j.runId)")"
echo "run=$RUN_ID queued"

STATUS="queued"
if [ "$ECHO" = "1" ]; then
  echo "==> serve --echo one tick (claim + echo executor)"
  (
    cd "$WORKDIR"
    "${BIN[@]}" serve --echo --poll-ms 1000 --db "$DB"
  ) &
  PID=$!
  sleep 12
  kill -TERM "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  STATUS="$(
    "${BIN[@]}" schedule history "$SPEC_ID" --json \
      | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j[0]?.status||'missing')"
  )"
  echo "final_status=$STATUS"
  if [ "$STATUS" != "done" ]; then
    echo "FAIL: expected status=done, got $STATUS"
    "${BIN[@]}" schedule history "$SPEC_ID" --json | head -c 2500
    echo
    exit 1
  fi
fi

echo "OK example1 smoke (db=$DB status=$STATUS)"
