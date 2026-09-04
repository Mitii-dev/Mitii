#!/usr/bin/env bash
# Smoke Example 2 — CI failure event ingest → matched/queued run.
# --echo only validates ingress + match (agent echo cannot apply edits).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

DB="$(mktemp "${TMPDIR:-/tmp}/mitii-e2e2.XXXXXX").db"
export MITII_AUTOMATION_DB="$DB"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mitii-e2e2-ws.XXXXXX")"
trap 'rm -f "$DB"; rm -rf "$WORKDIR"' EXIT

mkdir -p "$WORKDIR/.mitii/cron/events"
cp "$ROOT/docs/automation/cron/events/ci-failure.event.md" \
  "$WORKDIR/.mitii/cron/events/ci-failure.event.md"

echo "==> building packages"
pnpm --filter @mitii/automation build >/dev/null
pnpm --filter @mitii/cli build >/dev/null
BIN=(node "$ROOT/apps/cli/bin/mitii.js")

echo "==> reconcile event specs into DB"
(
  cd "$WORKDIR"
  "${BIN[@]}" schedule reconcile --json
)

PAYLOAD="$WORKDIR/payload.json"
cat > "$PAYLOAD" <<'EOF'
{
  "action": "completed",
  "repository": { "full_name": "acme/demo" },
  "workflow_run": {
    "id": 424242,
    "name": "CI",
    "conclusion": "failure",
    "head_sha": "deadbeefcafebabe",
    "updated_at": "2026-08-30T12:00:00.000Z"
  }
}
EOF

echo "==> ingest github.workflow_run.completed failure"
"${BIN[@]}" events ingest \
  --type github.workflow_run.completed \
  --source github \
  --id "smoke_ci_$(date +%s)" \
  --attr conclusion=failure \
  --json-file "$PAYLOAD" \
  --workspace "$WORKDIR" \
  --json | tee /tmp/mitii-e2e2-ingest.json

STATUS="$(node -e "const j=require('/tmp/mitii-e2e2-ingest.json'); console.log(j.event.processingStatus)")"
QUEUED="$(node -e "const j=require('/tmp/mitii-e2e2-ingest.json'); console.log(j.queuedRuns.length)")"
FILTERS="$(node -e "const j=require('/tmp/mitii-e2e2-ingest.json'); console.log(j.matchedSpecs[0]?.filtersJson||'')")"
echo "status=$STATUS queued=$QUEUED filters=$FILTERS"

if [ "$STATUS" != "queued" ] || [ "$QUEUED" = "0" ]; then
  echo "FAIL: expected queued run from ci-failure event spec"
  "${BIN[@]}" schedule list --json || true
  exit 1
fi

if [ "$FILTERS" != '{"conclusion":"failure"}' ]; then
  echo "FAIL: expected filtersJson conclusion=failure, got: $FILTERS"
  exit 1
fi

# Success conclusion must not queue (filter.conclusion=failure).
SUCCESS_PAYLOAD="$WORKDIR/success.json"
cat > "$SUCCESS_PAYLOAD" <<'EOF'
{
  "action": "completed",
  "repository": { "full_name": "acme/demo" },
  "workflow_run": {
    "id": 424243,
    "name": "CI",
    "conclusion": "success",
    "head_sha": "cafebabedeadbeef",
    "updated_at": "2026-08-30T13:00:00.000Z"
  }
}
EOF
"${BIN[@]}" events ingest \
  --type github.workflow_run.completed \
  --source github \
  --id "smoke_ci_ok_$(date +%s)" \
  --attr conclusion=success \
  --json-file "$SUCCESS_PAYLOAD" \
  --workspace "$WORKDIR" \
  --json > /tmp/mitii-e2e2-success.json
OK_QUEUED="$(node -e "const j=require('/tmp/mitii-e2e2-success.json'); console.log(j.queuedRuns.length)")"
OK_STATUS="$(node -e "const j=require('/tmp/mitii-e2e2-success.json'); console.log(j.event.processingStatus)")"
echo "success_status=$OK_STATUS success_queued=$OK_QUEUED"
if [ "$OK_QUEUED" != "0" ]; then
  echo "FAIL: success conclusion should not queue under filter.conclusion=failure"
  exit 1
fi

echo "OK example2 smoke (db=$DB status=$STATUS queued=$QUEUED)"
