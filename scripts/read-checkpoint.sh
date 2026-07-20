#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

if [[ ! -f .mitii-state.json ]]; then
  echo "No .mitii-state.json checkpoint found in $ROOT" >&2
  exit 1
fi

# Optional identity gates — set by the agent when resuming a known task target.
export THUNDER_CHECKPOINT_EXPECTED_TARGET="${THUNDER_CHECKPOINT_EXPECTED_TARGET:-}"
export THUNDER_CHECKPOINT_EXPECTED_GOAL_HASH="${THUNDER_CHECKPOINT_EXPECTED_GOAL_HASH:-}"
export THUNDER_CHECKPOINT_EXPECTED_PLAN_ID="${THUNDER_CHECKPOINT_EXPECTED_PLAN_ID:-}"

node <<'NODE'
const { readFileSync } = require('fs');

const checkpoint = JSON.parse(readFileSync('.mitii-state.json', 'utf8'));
const expectedTarget = (process.env.THUNDER_CHECKPOINT_EXPECTED_TARGET || '').trim();
const expectedGoalHash = (process.env.THUNDER_CHECKPOINT_EXPECTED_GOAL_HASH || '').trim();
const expectedPlanId = (process.env.THUNDER_CHECKPOINT_EXPECTED_PLAN_ID || '').trim();

function normalizeId(value) {
  return String(value || '').trim().toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

const mismatches = [];
if (expectedTarget) {
  if (!checkpoint.targetProjectId) {
    console.error(`CHECKPOINT_TASK_MISMATCH: checkpoint has no targetProjectId; current target=${expectedTarget}`);
    process.exit(2);
  }
  if (normalizeId(checkpoint.targetProjectId) !== normalizeId(expectedTarget)) {
    mismatches.push(`checkpoint target=${checkpoint.targetProjectId} current target=${expectedTarget}`);
  }
}
if (expectedGoalHash) {
  if (!checkpoint.goalHash) {
    console.error('CHECKPOINT_TASK_MISMATCH: checkpoint has no goalHash for the current task.');
    process.exit(2);
  }
  if (checkpoint.goalHash !== expectedGoalHash) {
    mismatches.push('goalHash mismatch');
  }
}
if (expectedPlanId && checkpoint.planId && checkpoint.planId !== expectedPlanId) {
  mismatches.push(`checkpoint planId=${checkpoint.planId} current planId=${expectedPlanId}`);
}

if (mismatches.length > 0) {
  console.error(`CHECKPOINT_TASK_MISMATCH: ${mismatches.join('; ')}`);
  process.exit(2);
}

console.log(`Saved: ${checkpoint.savedAt}`);
console.log(`Branch: ${checkpoint.branch || '(unknown)'}`);
console.log(`Commit: ${checkpoint.commit || '(unknown)'}`);
if (checkpoint.targetProjectId) console.log(`Target: ${checkpoint.targetProjectId}`);
if (checkpoint.goalHash) console.log(`GoalHash: ${checkpoint.goalHash}`);
if (checkpoint.planId) console.log(`PlanId: ${checkpoint.planId}`);
console.log('');
console.log('Plan:');
console.log(checkpoint.plan || '(empty)');
if (checkpoint.findings) {
  console.log('');
  console.log('Findings:');
  console.log(checkpoint.findings);
}
if (checkpoint.gitStatus) {
  console.log('');
  console.log('Git status at checkpoint:');
  console.log(checkpoint.gitStatus);
}
NODE
