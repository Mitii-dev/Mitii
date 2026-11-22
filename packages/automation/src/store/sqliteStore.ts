import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { nowIso } from '../paths.js';
import type {
  AutomationEventEnvelope,
  AutomationEventLogRecord,
  EventProcessingStatus,
} from '../events/types.js';
import type {
  AutomationDeliveryRecord,
  DeliveryAdapter,
  DeliveryStatus,
} from '../delivery/types.js';
import type {
  AutomationRunRecord,
  AutomationSpecRecord,
  ListRunsOptions,
  ListSpecsOptions,
  RunTriggerKind,
} from '../types.js';
import {
  getDelivery,
  insertDelivery,
  listDeliveries,
  updateDelivery,
} from './deliveryQueries.js';
import { boolToInt, mapEventLog, mapRun, mapSpec } from './rowMappers.js';
import { AUTOMATION_SCHEMA_STATEMENTS } from './schema.js';
import { type UpsertSpecInput, writeSpecRow } from './specUpsert.js';

export type { UpsertSpecInput } from './specUpsert.js';

type SqliteDb = Database.Database;

/** Host-injected opener (VS Code passes Electron-native better-sqlite3 bindings). */
export type OpenAutomationSqliteDatabase = (
  filename: string,
  options?: Database.Options,
) => SqliteDb;

export type SqliteAutomationStoreOptions = {
  openDatabase?: OpenAutomationSqliteDatabase;
};

export class SqliteAutomationStore {
  readonly db: SqliteDb;
  readonly dbPath: string;

  constructor(dbPath: string, options: SqliteAutomationStoreOptions = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    const open =
      options.openDatabase ??
      ((filename, openOptions) => new Database(filename, openOptions));
    this.db = open(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    for (const statement of AUTOMATION_SCHEMA_STATEMENTS) {
      this.db.exec(statement);
    }
  }

  close(): void {
    this.db.close();
  }

  getSpec(specId: string): AutomationSpecRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM automation_specs WHERE spec_id = ?`)
      .get(specId) as Record<string, unknown> | undefined;
    return row ? mapSpec(row) : undefined;
  }

  getSpecByExternalId(externalId: string): AutomationSpecRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM automation_specs WHERE external_id = ?`)
      .get(externalId) as Record<string, unknown> | undefined;
    return row ? mapSpec(row) : undefined;
  }

  getSpecBySourcePath(sourcePath: string): AutomationSpecRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM automation_specs WHERE source_path = ?`)
      .get(sourcePath) as Record<string, unknown> | undefined;
    return row ? mapSpec(row) : undefined;
  }

  listSpecs(options: ListSpecsOptions = {}): AutomationSpecRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!options.includeRemoved) {
      clauses.push('removed = 0');
    }
    if (options.enabledOnly) {
      clauses.push('enabled = 1');
    }
    if (options.workspaceRoot) {
      clauses.push('workspace_root = ?');
      params.push(options.workspaceRoot);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM automation_specs ${where} ORDER BY created_at DESC`,
      )
      .all(...params) as Record<string, unknown>[];
    return rows.map(mapSpec);
  }

  upsertSpec(input: UpsertSpecInput): AutomationSpecRecord {
    const existing =
      this.getSpec(input.specId) ?? this.getSpecBySourcePath(input.sourcePath);
    const specId = writeSpecRow(this.db, input, existing, nowIso());
    return this.getSpec(specId)!;
  }

  setSpecEnabled(specId: string, enabled: boolean): void {
    this.db
      .prepare(
        `UPDATE automation_specs SET enabled = ?, updated_at = ? WHERE spec_id = ?`,
      )
      .run(boolToInt(enabled), nowIso(), specId);
  }

  markSpecRemoved(specId: string): void {
    this.db
      .prepare(
        `UPDATE automation_specs SET removed = 1, enabled = 0, updated_at = ? WHERE spec_id = ?`,
      )
      .run(nowIso(), specId);
  }

  deleteSpec(specId: string): void {
    this.db.prepare(`DELETE FROM automation_specs WHERE spec_id = ?`).run(specId);
  }

  updateSpecScheduleCursor(input: {
    specId: string;
    nextRunAt: string | null;
    lastRunAt?: string | null;
    lastMaterializedRunId?: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE automation_specs SET
          next_run_at = @nextRunAt,
          last_run_at = COALESCE(@lastRunAt, last_run_at),
          last_materialized_run_id = COALESCE(@lastMaterializedRunId, last_materialized_run_id),
          updated_at = @updatedAt
        WHERE spec_id = @specId`,
      )
      .run({
        specId: input.specId,
        nextRunAt: input.nextRunAt,
        lastRunAt: input.lastRunAt ?? null,
        lastMaterializedRunId: input.lastMaterializedRunId ?? null,
        updatedAt: nowIso(),
      });
  }

  enqueueRun(input: {
    runId: string;
    specId: string;
    specRevision: number;
    triggerKind: RunTriggerKind;
    scheduledFor?: string | null;
    triggerEventId?: string | null;
  }): AutomationRunRecord {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO automation_runs (
          run_id, spec_id, spec_revision, trigger_kind, status,
          scheduled_for, trigger_event_id, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?)`,
      )
      .run(
        input.runId,
        input.specId,
        input.specRevision,
        input.triggerKind,
        input.scheduledFor ?? now,
        input.triggerEventId ?? null,
        now,
        now,
      );
    return this.getRun(input.runId)!;
  }

  getRun(runId: string): AutomationRunRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM automation_runs WHERE run_id = ?`)
      .get(runId) as Record<string, unknown> | undefined;
    return row ? mapRun(row) : undefined;
  }

  listRuns(options: ListRunsOptions = {}): AutomationRunRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.specId) {
      clauses.push('spec_id = ?');
      params.push(options.specId);
    }
    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM automation_runs ${where} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params, limit) as Record<string, unknown>[];
    return rows.map(mapRun);
  }

  countActiveRunsForSpec(specId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM automation_runs
         WHERE spec_id = ? AND status IN ('queued', 'running')`,
      )
      .get(specId) as { c: number };
    return Number(row.c);
  }

  countRunningGlobal(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM automation_runs WHERE status = 'running'`,
      )
      .get() as { c: number };
    return Number(row.c);
  }

  /**
   * Atomically claim the next queued run whose schedule is due and whose
   * lease is free. Returns undefined when nothing is claimable.
   */
  claimNextRun(input: {
    claimToken: string;
    leaseSeconds: number;
    now?: Date;
  }): AutomationRunRecord | undefined {
    const now = input.now ?? new Date();
    const nowIsoStr = nowIso(now);
    const leaseUntil = nowIso(
      new Date(now.getTime() + input.leaseSeconds * 1000),
    );

    const tx = this.db.transaction(() => {
      // Prefer reclaiming expired running leases, then due queued runs.
      const expired = this.db
        .prepare(
          `SELECT * FROM automation_runs
           WHERE status = 'running'
             AND claim_until_at IS NOT NULL
             AND claim_until_at < ?
           ORDER BY claim_until_at ASC
           LIMIT 1`,
        )
        .get(nowIsoStr) as Record<string, unknown> | undefined;

      const queued = this.db
        .prepare(
          `SELECT * FROM automation_runs
           WHERE status = 'queued'
             AND (scheduled_for IS NULL OR scheduled_for <= ?)
             AND (claim_until_at IS NULL OR claim_until_at < ?)
           ORDER BY scheduled_for ASC, created_at ASC
           LIMIT 1`,
        )
        .get(nowIsoStr, nowIsoStr) as Record<string, unknown> | undefined;

      const target = expired ?? queued;
      if (!target) return undefined;

      this.db
        .prepare(
          `UPDATE automation_runs SET
            status = 'running',
            claim_token = ?,
            claim_started_at = ?,
            claim_until_at = ?,
            started_at = COALESCE(started_at, ?),
            attempt_count = attempt_count + 1,
            updated_at = ?
          WHERE run_id = ?`,
        )
        .run(
          input.claimToken,
          nowIsoStr,
          leaseUntil,
          nowIsoStr,
          nowIsoStr,
          String(target.run_id),
        );
      return this.getRun(String(target.run_id));
    });

    return tx();
  }

  heartbeatClaim(input: {
    runId: string;
    claimToken: string;
    leaseSeconds: number;
  }): boolean {
    const until = nowIso(new Date(Date.now() + input.leaseSeconds * 1000));
    const result = this.db
      .prepare(
        `UPDATE automation_runs SET claim_until_at = ?, updated_at = ?
         WHERE run_id = ? AND claim_token = ? AND status = 'running'`,
      )
      .run(until, nowIso(), input.runId, input.claimToken);
    return result.changes > 0;
  }

  completeRun(input: {
    runId: string;
    claimToken: string;
    status: 'done' | 'failed' | 'cancelled';
    error?: string | null;
    reportPath?: string | null;
    sessionId?: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE automation_runs SET
          status = ?,
          error = ?,
          report_path = COALESCE(?, report_path),
          session_id = COALESCE(?, session_id),
          completed_at = ?,
          claim_token = NULL,
          claim_until_at = NULL,
          updated_at = ?
        WHERE run_id = ? AND (claim_token = ? OR claim_token IS NULL)`,
      )
      .run(
        input.status,
        input.error ?? null,
        input.reportPath ?? null,
        input.sessionId ?? null,
        nowIso(),
        nowIso(),
        input.runId,
        input.claimToken,
      );
  }

  cancelQueuedRunsForSpec(specId: string): number {
    const result = this.db
      .prepare(
        `UPDATE automation_runs SET status = 'cancelled', updated_at = ?
         WHERE spec_id = ? AND status = 'queued'`,
      )
      .run(nowIso(), specId);
    return result.changes;
  }

  listEventSpecsForType(eventType: string): AutomationSpecRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM automation_specs
         WHERE trigger_kind = 'event'
           AND enabled = 1
           AND removed = 0
           AND parse_status = 'valid'
           AND (event_type = ? OR event_type = '*' OR event_type IS NULL)
         ORDER BY updated_at DESC`,
      )
      .all(eventType) as Record<string, unknown>[];
    // NULL / * match any; prefer exact type first
    return rows
      .map(mapSpec)
      .filter(
        (spec) =>
          !spec.eventType ||
          spec.eventType === '*' ||
          spec.eventType === eventType,
      );
  }

  insertEventLog(
    event: AutomationEventEnvelope,
    options: { receivedAtIso: string },
  ): { created: boolean; record: AutomationEventLogRecord } {
    const existing = this.getEventLog(event.eventId);
    if (existing) {
      return { created: false, record: existing };
    }
    const now = options.receivedAtIso;
    this.db
      .prepare(
        `INSERT INTO automation_event_log (
          event_id, event_type, source, subject, occurred_at, received_at,
          workspace_root, dedupe_key, payload_json, attributes_json,
          processing_status, matched_spec_count, queued_run_count, suppressed_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', 0, 0, 0, ?, ?)`,
      )
      .run(
        event.eventId,
        event.eventType,
        event.source,
        event.subject ?? null,
        event.occurredAt ?? now,
        now,
        event.workspaceRoot ?? null,
        event.dedupeKey ?? null,
        event.payload ? JSON.stringify(event.payload) : null,
        event.attributes ? JSON.stringify(event.attributes) : null,
        now,
        now,
      );
    return { created: true, record: this.getEventLog(event.eventId)! };
  }

  getEventLog(eventId: string): AutomationEventLogRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM automation_event_log WHERE event_id = ?`)
      .get(eventId) as Record<string, unknown> | undefined;
    return row ? mapEventLog(row) : undefined;
  }

  listEventLogs(options: { limit?: number } = {}): AutomationEventLogRecord[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM automation_event_log ORDER BY received_at DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapEventLog);
  }

  updateEventLogProcessing(
    eventId: string,
    update: {
      status: EventProcessingStatus;
      matchedSpecCount?: number;
      queuedRunCount?: number;
      suppressedCount?: number;
      error?: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE automation_event_log SET
          processing_status = ?,
          matched_spec_count = COALESCE(?, matched_spec_count),
          queued_run_count = COALESCE(?, queued_run_count),
          suppressed_count = COALESCE(?, suppressed_count),
          error = COALESCE(?, error),
          updated_at = ?
         WHERE event_id = ?`,
      )
      .run(
        update.status,
        update.matchedSpecCount ?? null,
        update.queuedRunCount ?? null,
        update.suppressedCount ?? null,
        update.error ?? null,
        nowIso(),
        eventId,
      );
  }

  hasRecentEventRunForDedupe(options: {
    specId: string;
    dedupeKey: string;
    sinceIso: string;
  }): boolean {
    const row = this.db
      .prepare(
        `SELECT r.run_id FROM automation_runs r
         INNER JOIN automation_event_log e ON e.event_id = r.trigger_event_id
         WHERE r.spec_id = ?
           AND r.trigger_kind = 'event'
           AND e.dedupe_key = ?
           AND e.received_at >= ?
         LIMIT 1`,
      )
      .get(options.specId, options.dedupeKey, options.sinceIso);
    return !!row;
  }

  hasRecentEventRunForSpec(options: {
    specId: string;
    sinceIso: string;
  }): boolean {
    const row = this.db
      .prepare(
        `SELECT r.run_id FROM automation_runs r
         INNER JOIN automation_event_log e ON e.event_id = r.trigger_event_id
         WHERE r.spec_id = ?
           AND r.trigger_kind = 'event'
           AND e.received_at >= ?
         LIMIT 1`,
      )
      .get(options.specId, options.sinceIso);
    return !!row;
  }

  findQueuedEventRunForDedupe(options: {
    specId: string;
    dedupeKey: string;
  }): AutomationRunRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT r.* FROM automation_runs r
         INNER JOIN automation_event_log e ON e.event_id = r.trigger_event_id
         WHERE r.spec_id = ?
           AND r.trigger_kind = 'event'
           AND r.status = 'queued'
           AND e.dedupe_key = ?
         ORDER BY COALESCE(r.scheduled_for, r.created_at) DESC
         LIMIT 1`,
      )
      .get(options.specId, options.dedupeKey) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRun(row) : undefined;
  }

  updateQueuedEventRunForDebounce(input: {
    runId: string;
    triggerEventId: string;
    scheduledFor: string;
  }): AutomationRunRecord | undefined {
    this.db
      .prepare(
        `UPDATE automation_runs SET
          trigger_event_id = ?,
          scheduled_for = ?,
          updated_at = ?
         WHERE run_id = ? AND status = 'queued'`,
      )
      .run(
        input.triggerEventId,
        input.scheduledFor,
        nowIso(),
        input.runId,
      );
    return this.getRun(input.runId);
  }

  insertDelivery(input: {
    deliveryId: string;
    runId: string;
    adapter: DeliveryAdapter;
    targetJson: string;
  }): AutomationDeliveryRecord {
    return insertDelivery(this.db, input);
  }

  getDelivery(deliveryId: string): AutomationDeliveryRecord | undefined {
    return getDelivery(this.db, deliveryId);
  }

  listDeliveries(
    options: { status?: DeliveryStatus; runId?: string; limit?: number } = {},
  ): AutomationDeliveryRecord[] {
    return listDeliveries(this.db, options);
  }

  updateDelivery(input: {
    deliveryId: string;
    status: DeliveryStatus;
    error?: string | null;
    bumpAttempt?: boolean;
  }): void {
    updateDelivery(this.db, input);
  }
}
