import type Database from 'better-sqlite3';

import type { AutomationSpecRecord, TriggerKind } from '../types.js';
import { boolToInt } from './rowMappers.js';

type SqliteDb = Database.Database;

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

/**
 * Insert a new spec row or update `existing` in place; returns the spec id.
 * Callers re-read the persisted record.
 */
export function writeSpecRow(
  db: SqliteDb,
  input: UpsertSpecInput,
  existing: AutomationSpecRecord | undefined,
  now: string,
): string {
  if (!existing) {
    db
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
    return input.specId;
  }

  const revision =
    input.bumpRevision === true ? existing.revision + 1 : existing.revision;
  db
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
  return existing.specId;
}
