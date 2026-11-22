/**
 * Per-case outcome buckets and per-stage timings derived from agent stdout.
 * Pure helpers: no filesystem or process access.
 */

/** Check types that measure process liveness, not whether the content is right. */
const LIVENESS_CHECK_TYPES = new Set(['agent_exit', 'jsonl_event']);

export const OUTCOME_BUCKETS = Object.freeze([
  'passed',
  'timeout_content_pass',
  'timeout',
  'aborted',
  'failed',
]);

/**
 * True when every content check passed, ignoring process-liveness checks
 * (exit code / end event) that a harness timeout necessarily breaks.
 */
export function isContentPass(checks) {
  const content = (checks ?? []).filter((check) => !LIVENESS_CHECK_TYPES.has(check?.type));
  return content.length > 0 && content.every((check) => check?.passed === true);
}

/**
 * @param {{ passed: boolean, timedOut?: boolean, aborted?: boolean, checks?: Array<{type?: string, passed?: boolean}> }} run
 * @returns {'passed'|'timeout_content_pass'|'timeout'|'aborted'|'failed'}
 */
export function classifyOutcome(run) {
  if (run.aborted) return 'aborted';
  if (run.timedOut) return isContentPass(run.checks) ? 'timeout_content_pass' : 'timeout';
  return run.passed ? 'passed' : 'failed';
}

/** Stage event name → report field. Repeated stages (model/tool turns) are summed. */
const STAGE_FIELD = Object.freeze({
  understood: 'understandingMs',
  discovery: 'discoveryMs',
  plan_ready: 'planningMs',
  model_running: 'loopMs',
  tool_running: 'loopMs',
  verifying: 'verifyMs',
});

export const STAGE_TIMING_FIELDS = Object.freeze([
  'understandingMs',
  'discoveryMs',
  'planningMs',
  'loopMs',
  'verifyMs',
]);

function emptyTimings() {
  return Object.fromEntries(STAGE_TIMING_FIELDS.map((field) => [field, null]));
}

/**
 * Sum stage_started → stage_completed spans from JSONL run events.
 * A stage still open when events stop (harness timeout) is closed at the last
 * event timestamp. Fields stay `null` when the stage never appeared or events
 * carry no timestamps.
 */
export function extractStageTimings(stdout) {
  const timings = emptyTimings();
  if (!stdout) return timings;
  const open = new Map();
  let lastAt = null;
  const add = (stage, ms) => {
    const field = STAGE_FIELD[stage];
    if (!field || !Number.isFinite(ms) || ms < 0) return;
    timings[field] = (timings[field] ?? 0) + ms;
  };
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof event?.at !== 'string') continue;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    lastAt = at;
    if (!(event.stage in STAGE_FIELD)) continue;
    if (event.type === 'stage_started') {
      if (open.has(event.stage)) add(event.stage, at - open.get(event.stage));
      open.set(event.stage, at);
    } else if (event.type === 'stage_completed' && open.has(event.stage)) {
      add(event.stage, at - open.get(event.stage));
      open.delete(event.stage);
    }
  }
  if (lastAt !== null) {
    for (const [stage, startedAt] of open) add(stage, lastAt - startedAt);
  }
  return timings;
}
