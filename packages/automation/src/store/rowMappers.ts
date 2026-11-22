import type {
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
  RunStatus,
  RunTriggerKind,
  TriggerKind,
} from '../types.js';

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

export function intToBool(value: number | null | undefined): boolean {
  return value === 1;
}

export function mapSpec(row: Record<string, unknown>): AutomationSpecRecord {
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

export function mapRun(row: Record<string, unknown>): AutomationRunRecord {
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

export function mapEventLog(row: Record<string, unknown>): AutomationEventLogRecord {
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

export function mapDelivery(row: Record<string, unknown>): AutomationDeliveryRecord {
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
