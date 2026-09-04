import { getNextCronIso } from './cron/next.js';
import { newId, nowIso } from './paths.js';
import type { SqliteAutomationStore } from './store/sqliteStore.js';
import type { AutomationRunRecord, AutomationSpecRecord } from './types.js';

export interface MaterializeResult {
  enqueued: AutomationRunRecord[];
  advanced: string[];
}

/**
 * Enqueue due schedule / one_off work. One overdue catch-up per schedule
 * spec, then advance next_run_at.
 */
export function materializeDueRuns(
  store: SqliteAutomationStore,
  options: { now?: Date } = {},
): MaterializeResult {
  const now = options.now ?? new Date();
  const nowIsoStr = nowIso(now);
  const enqueued: AutomationRunRecord[] = [];
  const advanced: string[] = [];

  const specs = store
    .listSpecs({ enabledOnly: true })
    .filter((spec) => spec.parseStatus === 'valid' && !spec.removed);

  for (const spec of specs) {
    if (spec.triggerKind === 'schedule') {
      const run = materializeSchedule(store, spec, now, nowIsoStr);
      if (run) {
        enqueued.push(run);
        advanced.push(spec.specId);
      }
      continue;
    }
    if (spec.triggerKind === 'one_off') {
      const run = materializeOneOff(store, spec, nowIsoStr);
      if (run) enqueued.push(run);
    }
  }

  return { enqueued, advanced };
}

function materializeSchedule(
  store: SqliteAutomationStore,
  spec: AutomationSpecRecord,
  now: Date,
  nowIsoStr: string,
): AutomationRunRecord | undefined {
  if (!spec.scheduleExpr) return undefined;

  let nextRunAt = spec.nextRunAt;
  if (!nextRunAt) {
    nextRunAt = getNextCronIso(
      spec.scheduleExpr,
      now.getTime() - 60_000,
      spec.timezone ?? undefined,
    );
    store.updateSpecScheduleCursor({
      specId: spec.specId,
      nextRunAt,
    });
  }

  if (nextRunAt > nowIsoStr) {
    return undefined;
  }

  const maxParallel = spec.maxParallel ?? 1;
  if (store.countActiveRunsForSpec(spec.specId) >= maxParallel) {
    return undefined;
  }

  const runId = newId('run');
  const run = store.enqueueRun({
    runId,
    specId: spec.specId,
    specRevision: spec.revision,
    triggerKind: 'schedule',
    scheduledFor: nextRunAt,
  });

  // Catch-up once: advance from "now", not from the overdue slot.
  const following = getNextCronIso(
    spec.scheduleExpr,
    now.getTime(),
    spec.timezone ?? undefined,
  );
  store.updateSpecScheduleCursor({
    specId: spec.specId,
    nextRunAt: following,
    lastRunAt: nowIsoStr,
    lastMaterializedRunId: runId,
  });
  return run;
}

function materializeOneOff(
  store: SqliteAutomationStore,
  spec: AutomationSpecRecord,
  nowIsoStr: string,
): AutomationRunRecord | undefined {
  if (store.countActiveRunsForSpec(spec.specId) > 0) {
    return undefined;
  }
  const prior = store.listRuns({ specId: spec.specId, limit: 20 });
  const existsForRevision = prior.some(
    (run) => run.specRevision === spec.revision,
  );
  if (existsForRevision) return undefined;

  const runId = newId('run');
  return store.enqueueRun({
    runId,
    specId: spec.specId,
    specRevision: spec.revision,
    triggerKind: 'one_off',
    scheduledFor: nowIsoStr,
  });
}

export function enqueueManualTrigger(
  store: SqliteAutomationStore,
  spec: AutomationSpecRecord,
): AutomationRunRecord {
  const maxParallel = spec.maxParallel ?? 1;
  if (store.countActiveRunsForSpec(spec.specId) >= maxParallel) {
    throw new Error(
      `Spec "${spec.title}" already has ${maxParallel} active run(s)`,
    );
  }
  return store.enqueueRun({
    runId: newId('run'),
    specId: spec.specId,
    specRevision: spec.revision,
    triggerKind: 'manual',
    scheduledFor: nowIso(),
  });
}
