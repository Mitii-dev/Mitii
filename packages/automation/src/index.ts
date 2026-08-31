export { AUTOMATION_SCHEMA_VERSION } from './types.js';
export type {
  AutomationAgentMode,
  AutomationAutonomyPreset,
  AutomationRunRecord,
  AutomationServeOptions,
  AutomationSpecRecord,
  CreateScheduleInput,
  ListRunsOptions,
  ListSpecsOptions,
  RunStatus,
  RunTriggerKind,
  SpecSource,
  TriggerKind,
} from './types.js';
export {
  createScheduleInputSchema,
  AGENT_MODES,
  AUTONOMY_PRESETS,
  RUN_STATUSES,
  TRIGGER_KINDS,
} from './types.js';

export {
  resolveAutomationDbPath,
  resolveAutomationHome,
  resolveAutomationReportsDir,
  resolveGlobalCronDir,
  resolveWorkspaceCronDir,
  newId,
  nowIso,
  sha256Hex,
} from './paths.js';

export {
  parseCron,
  validateCronPattern,
  getNextCronTime,
  getNextCronIso,
} from './cron/next.js';
export type { ParsedCron } from './cron/next.js';

export { SqliteAutomationStore } from './store/sqliteStore.js';
export type { UpsertSpecInput } from './store/sqliteStore.js';
export { AUTOMATION_SCHEMA_STATEMENTS } from './store/schema.js';

export {
  materializeDueRuns,
  enqueueManualTrigger,
} from './materializer.js';
export type { MaterializeResult } from './materializer.js';

export { ClaimRunner } from './runner/claimRunner.js';
export type {
  ClaimRunnerEvent,
  ClaimRunnerOptions,
} from './runner/claimRunner.js';
export type {
  AutomationExecuteInput,
  AutomationExecuteResult,
  AutomationRunExecutor,
} from './runner/types.js';

export {
  parseCronMarkdown,
  reconcileCronSpecsDir,
} from './specs/reconciler.js';
export type {
  ParsedCronMd,
  ReconcileResult,
} from './specs/reconciler.js';

export { AutomationService } from './service.js';
export type { AutomationServiceOptions } from './service.js';

export { EventIngress } from './events/ingress.js';
export {
  automationEventMatchesFilters,
  parseFiltersJson,
} from './events/filters.js';
export { normalizeGitHubWebhook } from './events/github.js';
export { buildEventDedupeKey } from './events/fingerprint.js';
export {
  automationEventEnvelopeSchema,
} from './events/types.js';
export type {
  AutomationEventEnvelope,
  AutomationEventLogRecord,
  EventIngressResult,
  EventProcessingStatus,
  EventSuppression,
  EventSuppressionReason,
} from './events/types.js';

export { packRunArtifacts } from './artifacts/pack.js';
export type { ArtifactPack, PackArtifactsInput } from './artifacts/pack.js';

export {
  buildIncidentFingerprint,
  formatIncidentIssueBody,
  formatIncidentIssueTitle,
  pullGithubActionsLogs,
  writeEvidencePack,
} from './incident/evidence.js';
export { prepareIncidentEvidence } from './incident/prepare.js';

export { startAutomationWebhookServer } from './webhook/server.js';
export type {
  AutomationWebhookServer,
  AutomationWebhookServerOptions,
} from './webhook/server.js';

export { DeliveryBus } from './delivery/bus.js';
export { createWebhookDeliverySender } from './delivery/webhookSender.js';
export {
  DELIVERY_ADAPTERS,
  DELIVERY_STATUSES,
  deliveryTargetSchema,
} from './delivery/types.js';
export type {
  AutomationDeliveryRecord,
  DeliveryAdapter,
  DeliverySender,
  DeliveryStatus,
  DeliveryTarget,
} from './delivery/types.js';
