#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

STDIN_TEXT=""
if [[ ! -t 0 ]]; then
  STDIN_TEXT="$(cat)"
fi

export THUNDER_CHECKPOINT_TEXT="${THUNDER_CHECKPOINT_TEXT:-${THUNDER_PLAN:-$STDIN_TEXT}}"
export THUNDER_CHECKPOINT_FINDINGS="${THUNDER_FINDINGS:-}"
export THUNDER_CHECKPOINT_PLAN_ID="${THUNDER_CHECKPOINT_PLAN_ID:-}"
export THUNDER_CHECKPOINT_GOAL_HASH="${THUNDER_CHECKPOINT_GOAL_HASH:-}"
export THUNDER_CHECKPOINT_TARGET_PROJECT="${THUNDER_CHECKPOINT_TARGET_PROJECT:-}"
export THUNDER_CHECKPOINT_WORKSPACE_REVISION="${THUNDER_CHECKPOINT_WORKSPACE_REVISION:-}"

node <<'NODE'
const { writeFileSync } = require('fs');
const { execSync } = require('child_process');

function git(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const checkpoint = {
  version: 2,
  savedAt: new Date().toISOString(),
  cwd: process.cwd(),
  branch: git('git branch --show-current'),
  commit: git('git rev-parse --short HEAD'),
  gitStatus: git('git status --short'),
  planId: process.env.THUNDER_CHECKPOINT_PLAN_ID || '',
  goalHash: process.env.THUNDER_CHECKPOINT_GOAL_HASH || '',
  targetProjectId: process.env.THUNDER_CHECKPOINT_TARGET_PROJECT || '',
  workspaceRevision: process.env.THUNDER_CHECKPOINT_WORKSPACE_REVISION || '',
  plan: process.env.THUNDER_CHECKPOINT_TEXT || '',
  findings: process.env.THUNDER_CHECKPOINT_FINDINGS || '',
};

writeFileSync('.mitii-state.json', `${JSON.stringify(checkpoint, null, 2)}\n`);
console.log('Wrote .mitii-state.json');
if (checkpoint.targetProjectId) {
  console.log(`targetProjectId=${checkpoint.targetProjectId}`);
}
if (checkpoint.goalHash) {
  console.log(`goalHash=${checkpoint.goalHash}`);
}
NODE
