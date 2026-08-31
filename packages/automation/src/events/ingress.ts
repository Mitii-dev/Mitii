import { newId } from '../paths.js';
import type { SqliteAutomationStore } from '../store/sqliteStore.js';
import type { AutomationRunRecord, AutomationSpecRecord } from '../types.js';
import {
  automationEventMatchesFilters,
  parseFiltersJson,
} from './filters.js';
import type {
  AutomationEventEnvelope,
  EventIngressResult,
  EventSuppression,
  EventSuppressionReason,
} from './types.js';
import { automationEventEnvelopeSchema } from './types.js';

export interface EventIngressOptions {
  store: SqliteAutomationStore;
  now?: () => number;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeIso(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  if (!candidate) return fallback;
  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(
    new Date(iso).getTime() + Math.max(0, Math.floor(seconds)) * 1000,
  ).toISOString();
}

function subtractSeconds(iso: string, seconds: number): string {
  return new Date(
    new Date(iso).getTime() - Math.max(0, Math.floor(seconds)) * 1000,
  ).toISOString();
}

function maxIso(a: string | undefined, b: string): string {
  if (!a) return b;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function normalizeEvent(
  event: AutomationEventEnvelope,
  receivedAt: string,
): AutomationEventEnvelope {
  const parsed = automationEventEnvelopeSchema.parse(event);
  const eventId = parsed.eventId.trim();
  const eventType = parsed.eventType.trim();
  const source = parsed.source.trim();
  const subject = trimOrUndefined(parsed.subject);
  const dedupeKey =
    trimOrUndefined(parsed.dedupeKey) ??
    `${eventType}:${source}:${subject ?? eventId}`;
  return {
    eventId,
    eventType,
    source,
    subject,
    occurredAt: normalizeIso(parsed.occurredAt, receivedAt),
    workspaceRoot: trimOrUndefined(parsed.workspaceRoot),
    payload: parsed.payload,
    attributes: parsed.attributes,
    dedupeKey,
  };
}

/**
 * Durable ingress: persist event → match event specs → enqueue runs.
 * Does not execute agents; ClaimRunner owns execution.
 */
export class EventIngress {
  private readonly store: SqliteAutomationStore;
  private readonly nowFn: () => number;

  constructor(options: EventIngressOptions) {
    this.store = options.store;
    this.nowFn = options.now ?? (() => Date.now());
  }

  ingestEvent(event: AutomationEventEnvelope): EventIngressResult {
    const receivedAt = new Date(this.nowFn()).toISOString();
    const normalized = normalizeEvent(event, receivedAt);
    const inserted = this.store.insertEventLog(normalized, {
      receivedAtIso: receivedAt,
    });
    if (!inserted.created) {
      return {
        event: inserted.record,
        duplicate: true,
        matchedSpecs: [],
        queuedRuns: [],
        suppressions: [
          {
            reason: 'duplicate_event',
            dedupeKey: inserted.record.dedupeKey ?? undefined,
          },
        ],
      };
    }

    try {
      const candidates = this.store.listEventSpecsForType(normalized.eventType);
      const suppressions: EventSuppression[] = [];
      const matchedSpecs: AutomationSpecRecord[] = [];
      const queuedRuns: AutomationRunRecord[] = [];

      for (const spec of candidates) {
        const filters = parseFiltersJson(spec.filtersJson);
        if (!automationEventMatchesFilters(normalized, filters)) {
          suppressions.push({
            specId: spec.specId,
            externalId: spec.externalId,
            reason: 'filter_mismatch',
            dedupeKey: normalized.dedupeKey,
          });
          continue;
        }
        matchedSpecs.push(spec);
        const materialized = this.materializeForSpec(
          spec,
          normalized,
          inserted.record.receivedAt,
        );
        if (materialized.run) {
          queuedRuns.push(materialized.run);
        } else {
          suppressions.push({
            specId: spec.specId,
            externalId: spec.externalId,
            reason: materialized.reason,
            dedupeKey: normalized.dedupeKey,
          });
        }
      }

      const status =
        matchedSpecs.length === 0
          ? 'unmatched'
          : queuedRuns.length > 0
            ? 'queued'
            : 'suppressed';
      this.store.updateEventLogProcessing(inserted.record.eventId, {
        status,
        matchedSpecCount: matchedSpecs.length,
        queuedRunCount: queuedRuns.length,
        suppressedCount: suppressions.filter(
          (s) => s.reason !== 'filter_mismatch',
        ).length,
      });
      const updated = this.store.getEventLog(inserted.record.eventId);
      return {
        event: updated ?? inserted.record,
        duplicate: false,
        matchedSpecs,
        queuedRuns,
        suppressions,
      };
    } catch (err) {
      this.store.updateEventLogProcessing(inserted.record.eventId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private materializeForSpec(
    spec: AutomationSpecRecord,
    event: AutomationEventEnvelope,
    receivedAt: string,
  ): {
    run?: AutomationRunRecord;
    reason: Exclude<
      EventSuppressionReason,
      'duplicate_event' | 'filter_mismatch'
    >;
  } {
    const dedupeKey = event.dedupeKey ?? event.eventId;

    const debounceSeconds = spec.debounceSeconds ?? 0;
    if (debounceSeconds > 0) {
      const existing = this.store.findQueuedEventRunForDedupe({
        specId: spec.specId,
        dedupeKey,
      });
      if (existing) {
        const scheduledFor = maxIso(
          existing.scheduledFor ?? undefined,
          addSeconds(receivedAt, debounceSeconds),
        );
        const updated = this.store.updateQueuedEventRunForDebounce({
          runId: existing.runId,
          triggerEventId: event.eventId,
          scheduledFor,
        });
        if (updated) return { run: updated, reason: 'dedupe_window' };
      }
    }

    const dedupeWindowSeconds = spec.dedupeWindowSeconds ?? 0;
    if (
      dedupeWindowSeconds > 0 &&
      this.store.hasRecentEventRunForDedupe({
        specId: spec.specId,
        dedupeKey,
        sinceIso: subtractSeconds(receivedAt, dedupeWindowSeconds),
      })
    ) {
      return { reason: 'dedupe_window' };
    }

    const cooldownSeconds = spec.cooldownSeconds ?? 0;
    if (
      cooldownSeconds > 0 &&
      this.store.hasRecentEventRunForSpec({
        specId: spec.specId,
        sinceIso: subtractSeconds(receivedAt, cooldownSeconds),
      })
    ) {
      return { reason: 'cooldown' };
    }

    const maxParallel = spec.maxParallel ?? 1;
    if (
      maxParallel > 0 &&
      this.store.countActiveRunsForSpec(spec.specId) >= maxParallel
    ) {
      return { reason: 'max_parallel' };
    }

    const run = this.store.enqueueRun({
      runId: newId('run'),
      specId: spec.specId,
      specRevision: spec.revision,
      triggerKind: 'event',
      triggerEventId: event.eventId,
      scheduledFor:
        debounceSeconds > 0
          ? addSeconds(receivedAt, debounceSeconds)
          : receivedAt,
    });
    return { run, reason: 'dedupe_window' };
  }
}
