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
  RunStatus,
  RunTriggerKind,
  TriggerKind,
} from '../types.js';
import { AUTOMATION_SCHEMA_STATEMENTS } from './schema.js';

type SqliteDb = Database.Database;

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value: number | null | undefined): boolean {
  return value === 1;
}

function mapSpec(row: Record<string, unknown>): AutomationSpecRecord {
  return {
    specId: String(row.spec_id),
    externalId: String(row.external_id),
    sourcePath: String(row.source_path),
    triggerKind: row.trigger_kind as TriggerKind,
    sourceMtimeMs:
      row.source_mtime_ms == null ? null : Number(row.source_mtime_ms),
    sourceHash: row.source_hash == null ? null : String(row.source_hash),
    parseStatus: row.parse_status as 'valid' | 'invalid',
    parseError: row.parse_error == null ? null : String(row.parse_error),
    enabled: intToBool(Number(row.enabled)),
    removed: intToBool(Number(row.removed)),
    title: String(row.title),
    prompt: row.prompt == null ? null : String(row.prompt),
    workspaceRoot:
      row.workspace_root == null ? null : String(row.workspace_root),
    scheduleExpr:
      row.schedule_expr == null ? null : String(row.schedule_expr),
    timezone: row.timezone == null ? null : String(row.timezone),
    eventType: row.event_type == null ? null : String(row.event_type),
    filtersJson: row.filters_json == null ? null : String(row.filters_json),
    debounceSeconds:
      row.debounce_seconds == null ? null : Number(row.debounce_seconds),
    dedupeWindowSeconds:
      row.dedupe_window_seconds == null
        ? null
        : Number(row.dedupe_window_seconds),
    cooldownSeconds:
      row.cooldown_seconds == null ? null : Number(row.cooldown_seconds),
    mode: (row.mode as AutomationSpecRecord['mode']) ?? null,
    autonomyPreset:
      (row.autonomy_preset as AutomationSpecRecord['autonomyPreset']) ?? null,
    timeoutSeconds:
      row.timeout_seconds == null ? null : Number(row.timeout_seconds),
    maxParallel: row.max_parallel == null ? null : Number(row.max_parallel),
    source: (row.source as AutomationSpecRecord['source']) ?? 'api',
    tagsJson: row.tags_json == null ? null : String(row.tags_json),
    metadataJson:
      row.metadata_json == null ? null : String(row.metadata_json),
    revision: Number(row.revision),
    lastMaterializedRunId:
      row.last_materialized_run_id == null
        ? null
        : String(row.last_materialized_run_id),
    lastRunAt: row.last_run_at == null ? null : String(row.last_run_at),
    nextRunAt: row.next_run_at == null ? null : String(row.next_run_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRun(row: Record<string, unknown>): AutomationRunRecord {
  return {
    runId: String(row.run_id),
    specId: String(row.spec_id),
    specRevision: Number(row.spec_revision),
    triggerKind: row.trigger_kind as RunTriggerKind,
    status: row.status as RunStatus,
    claimToken: row.claim_token == null ? null : String(row.claim_token),
    claimStartedAt:
      row.claim_started_at == null ? null : String(row.claim_started_at),
    claimUntilAt:
      row.claim_until_at == null ? null : String(row.claim_until_at),
    scheduledFor:
      row.scheduled_for == null ? null : String(row.scheduled_for),
    triggerEventId:
      row.trigger_event_id == null ? null : String(row.trigger_event_id),
    startedAt: row.started_at == null ? null : String(row.started_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    sessionId: row.session_id == null ? null : String(row.session_id),
    reportPath: row.report_path == null ? null : String(row.report_path),
    error: row.error == null ? null : String(row.error),
    attemptCount: Number(row.attempt_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export interface UpsertSpecInput {
  specId: string;
  externalId: string;
  sourcePath: string;
  triggerKind: TriggerKind;
  sourceMtimeMs?: number | null;
  sourceHash?: string | null;
  parseStatus: 'valid' | 'invalid';
  parseError?: string | null;
  enabled?: boolean;
  removed?: boolean;
  title: string;
  prompt?: string | null;
  workspaceRoot?: string | null;
  scheduleExpr?: string | null;
  timezone?: string | null;
  eventType?: string | null;
  filtersJson?: string | null;
  debounceSeconds?: number | null;
  dedupeWindowSeconds?: number | null;
  cooldownSeconds?: number | null;
  mode?: AutomationSpecRecord['mode'];
  autonomyPreset?: AutomationSpecRecord['autonomyPreset'];
  timeoutSeconds?: number | null;
  maxParallel?: number | null;
  source?: AutomationSpecRecord['source'];
  tagsJson?: string | null;
  metadataJson?: string | null;
  nextRunAt?: string | null;
  bumpRevision?: boolean;
}

export class SqliteAutomationStore {
  readonly db: SqliteDb;
  readonly dbPath: string;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
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
    const existing = this.getSpec(input.specId) ?? this.getSpecBySourcePath(input.sourcePath);
    const now = nowIso();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO automation_specs (
            spec_id, external_id, source_path, trigger_kind, source_mtime_ms, source_hash,
            parse_status, parse_error, enabled, removed, title, prompt, workspace_root,
            schedule_expr, timezone, event_type, filters_json, debounce_seconds,
            dedupe_window_seconds, cooldown_seconds, mode, autonomy_preset, timeout_seconds,
            max_parallel, source, tags_json, metadata_json, revision, next_run_at,
            created_at, updated_at
          ) VALUES (
            @specId, @externalId, @sourcePath, @triggerKind, @sourceMtimeMs, @sourceHash,
            @parseStatus, @parseError, @enabled, @removed, @title, @prompt, @workspaceRoot,
            @scheduleExpr, @timezone, @eventType, @filtersJson, @debounceSeconds,
            @dedupeWindowSeconds, @cooldownSeconds, @mode, @autonomyPreset, @timeoutSeconds,
            @maxParallel, @source, @tagsJson, @metadataJson, 1, @nextRunAt,
            @createdAt, @updatedAt
          )`,
        )
        .run({
          specId: input.specId,
          externalId: input.externalId,
          sourcePath: input.sourcePath,
          triggerKind: input.triggerKind,
          sourceMtimeMs: input.sourceMtimeMs ?? null,
          sourceHash: input.sourceHash ?? null,
          parseStatus: input.parseStatus,
          parseError: input.parseError ?? null,
          enabled: boolToInt(input.enabled ?? true),
          removed: boolToInt(input.removed ?? false),
          title: input.title,
          prompt: input.prompt ?? null,
          workspaceRoot: input.workspaceRoot ?? null,
          scheduleExpr: input.scheduleExpr ?? null,
          timezone: input.timezone ?? null,
          eventType: input.eventType ?? null,
          filtersJson: input.filtersJson ?? null,
          debounceSeconds: input.debounceSeconds ?? null,
          dedupeWindowSeconds: input.dedupeWindowSeconds ?? null,
          cooldownSeconds: input.cooldownSeconds ?? null,
          mode: input.mode ?? null,
          autonomyPreset: input.autonomyPreset ?? null,
          timeoutSeconds: input.timeoutSeconds ?? null,
          maxParallel: input.maxParallel ?? null,
          source: input.source ?? 'api',
          tagsJson: input.tagsJson ?? null,
          metadataJson: input.metadataJson ?? null,
          nextRunAt: input.nextRunAt ?? null,
          createdAt: now,
          updatedAt: now,
        });
      return this.getSpec(input.specId)!;
    }

    const revision =
      input.bumpRevision === true ? existing.revision + 1 : existing.revision;
    this.db
      .prepare(
        `UPDATE automation_specs SET
          external_id = @externalId,
          source_path = @sourcePath,
          trigger_kind = @triggerKind,
          source_mtime_ms = @sourceMtimeMs,
          source_hash = @sourceHash,
          parse_status = @parseStatus,
          parse_error = @parseError,
          enabled = @enabled,
          removed = @removed,
          title = @title,
          prompt = @prompt,
          workspace_root = @workspaceRoot,
          schedule_expr = @scheduleExpr,
          timezone = @timezone,
          event_type = @eventType,
          filters_json = @filtersJson,
          debounce_seconds = @debounceSeconds,
          dedupe_window_seconds = @dedupeWindowSeconds,
          cooldown_seconds = @cooldownSeconds,
          mode = @mode,
          autonomy_preset = @autonomyPreset,
          timeout_seconds = @timeoutSeconds,
          max_parallel = @maxParallel,
          source = @source,
          tags_json = @tagsJson,
          metadata_json = @metadataJson,
          revision = @revision,
          next_run_at = COALESCE(@nextRunAt, next_run_at),
          updated_at = @updatedAt
        WHERE spec_id = @specId`,
      )
      .run({
        specId: existing.specId,
        externalId: input.externalId,
        sourcePath: input.sourcePath,
        triggerKind: input.triggerKind,
        sourceMtimeMs: input.sourceMtimeMs ?? null,
        sourceHash: input.sourceHash ?? null,
        parseStatus: input.parseStatus,
        parseError: input.parseError ?? null,
        enabled: boolToInt(input.enabled ?? existing.enabled),
        removed: boolToInt(input.removed ?? false),
        title: input.title,
        prompt: input.prompt ?? existing.prompt,
        workspaceRoot: input.workspaceRoot ?? existing.workspaceRoot,
        scheduleExpr: input.scheduleExpr ?? existing.scheduleExpr,
        timezone: input.timezone ?? existing.timezone,
        eventType: input.eventType ?? existing.eventType,
        filtersJson: input.filtersJson ?? existing.filtersJson,
        debounceSeconds: input.debounceSeconds ?? existing.debounceSeconds,
        dedupeWindowSeconds:
          input.dedupeWindowSeconds ?? existing.dedupeWindowSeconds,
        cooldownSeconds: input.cooldownSeconds ?? existing.cooldownSeconds,
        mode: input.mode ?? existing.mode,
        autonomyPreset: input.autonomyPreset ?? existing.autonomyPreset,
        timeoutSeconds: input.timeoutSeconds ?? existing.timeoutSeconds,
        maxParallel: input.maxParallel ?? existing.maxParallel,
        source: input.source ?? existing.source,
        tagsJson: input.tagsJson ?? existing.tagsJson,
        metadataJson: input.metadataJson ?? existing.metadataJson,
        revision,
        nextRunAt: input.nextRunAt ?? null,
        updatedAt: now,
      });
    return this.getSpec(existing.specId)!;
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
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO automation_deliveries (
          delivery_id, run_id, adapter, status, target_json, error, attempts,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, NULL, 0, ?, ?)`,
      )
      .run(
        input.deliveryId,
        input.runId,
        input.adapter,
        input.targetJson,
        now,
        now,
      );
    return this.getDelivery(input.deliveryId)!;
  }

  getDelivery(deliveryId: string): AutomationDeliveryRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM automation_deliveries WHERE delivery_id = ?`)
      .get(deliveryId) as Record<string, unknown> | undefined;
    return row ? mapDelivery(row) : undefined;
  }

  listDeliveries(options: {
    status?: DeliveryStatus;
    runId?: string;
    limit?: number;
  } = {}): AutomationDeliveryRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    if (options.runId) {
      clauses.push('run_id = ?');
      params.push(options.runId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM automation_deliveries ${where} ORDER BY created_at ASC LIMIT ?`,
      )
      .all(...params, limit) as Record<string, unknown>[];
    return rows.map(mapDelivery);
  }

  updateDelivery(input: {
    deliveryId: string;
    status: DeliveryStatus;
    error?: string | null;
    bumpAttempt?: boolean;
  }): void {
    if (input.bumpAttempt) {
      this.db
        .prepare(
          `UPDATE automation_deliveries SET
            status = ?,
            error = ?,
            attempts = attempts + 1,
            updated_at = ?
           WHERE delivery_id = ?`,
        )
        .run(
          input.status,
          input.error ?? null,
          nowIso(),
          input.deliveryId,
        );
      return;
    }
    this.db
      .prepare(
        `UPDATE automation_deliveries SET
          status = ?,
          error = ?,
          updated_at = ?
         WHERE delivery_id = ?`,
      )
      .run(
        input.status,
        input.error ?? null,
        nowIso(),
        input.deliveryId,
      );
  }
}

function mapEventLog(row: Record<string, unknown>): AutomationEventLogRecord {
  return {
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    source: String(row.source),
    subject: row.subject == null ? null : String(row.subject),
    occurredAt: String(row.occurred_at),
    receivedAt: String(row.received_at),
    workspaceRoot:
      row.workspace_root == null ? null : String(row.workspace_root),
    dedupeKey: row.dedupe_key == null ? null : String(row.dedupe_key),
    payloadJson: row.payload_json == null ? null : String(row.payload_json),
    attributesJson:
      row.attributes_json == null ? null : String(row.attributes_json),
    processingStatus: row.processing_status as EventProcessingStatus,
    matchedSpecCount: Number(row.matched_spec_count ?? 0),
    queuedRunCount: Number(row.queued_run_count ?? 0),
    suppressedCount: Number(row.suppressed_count ?? 0),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapDelivery(row: Record<string, unknown>): AutomationDeliveryRecord {
  return {
    deliveryId: String(row.delivery_id),
    runId: String(row.run_id),
    adapter: row.adapter as DeliveryAdapter,
    status: row.status as DeliveryStatus,
    targetJson: String(row.target_json),
    error: row.error == null ? null : String(row.error),
    attempts: Number(row.attempts ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
