import { z } from 'zod';

export const AUTOMATION_SCHEMA_VERSION = 1 as const;

export const TRIGGER_KINDS = [
  'schedule',
  'one_off',
  'event',
  'manual',
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const RUN_TRIGGER_KINDS = [
  'schedule',
  'one_off',
  'event',
  'manual',
  'retry',
] as const;
export type RunTriggerKind = (typeof RUN_TRIGGER_KINDS)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const AGENT_MODES = ['ask', 'plan', 'agent'] as const;
export type AutomationAgentMode = (typeof AGENT_MODES)[number];

export const AUTONOMY_PRESETS = [
  'readonly',
  'propose',
  'apply',
  'apply_and_pr',
] as const;
export type AutomationAutonomyPreset = (typeof AUTONOMY_PRESETS)[number];

export const SPEC_SOURCES = ['api', 'file', 'hub-schedule'] as const;
export type SpecSource = (typeof SPEC_SOURCES)[number];

export const createScheduleInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    prompt: z.string().min(1),
    workspaceRoot: z.string().min(1),
    cron: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    mode: z.enum(AGENT_MODES).optional(),
    autonomyPreset: z.enum(AUTONOMY_PRESETS).optional(),
    timeoutSeconds: z.number().int().positive().max(86_400).optional(),
    maxParallel: z.number().int().positive().max(32).optional(),
    enabled: z.boolean().optional(),
    tags: z.array(z.string().min(1)).max(32).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.cron) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cron expression is required for schedule.create',
        path: ['cron'],
      });
    }
  });

export type CreateScheduleInput = z.infer<typeof createScheduleInputSchema>;

export interface AutomationSpecRecord {
  specId: string;
  externalId: string;
  sourcePath: string;
  triggerKind: TriggerKind;
  sourceMtimeMs: number | null;
  sourceHash: string | null;
  parseStatus: 'valid' | 'invalid';
  parseError: string | null;
  enabled: boolean;
  removed: boolean;
  title: string;
  prompt: string | null;
  workspaceRoot: string | null;
  scheduleExpr: string | null;
  timezone: string | null;
  eventType: string | null;
  filtersJson: string | null;
  debounceSeconds: number | null;
  dedupeWindowSeconds: number | null;
  cooldownSeconds: number | null;
  mode: AutomationAgentMode | null;
  autonomyPreset: AutomationAutonomyPreset | null;
  timeoutSeconds: number | null;
  maxParallel: number | null;
  source: SpecSource;
  tagsJson: string | null;
  metadataJson: string | null;
  revision: number;
  lastMaterializedRunId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunRecord {
  runId: string;
  specId: string;
  specRevision: number;
  triggerKind: RunTriggerKind;
  status: RunStatus;
  claimToken: string | null;
  claimStartedAt: string | null;
  claimUntilAt: string | null;
  scheduledFor: string | null;
  triggerEventId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  sessionId: string | null;
  reportPath: string | null;
  error: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListSpecsOptions {
  includeRemoved?: boolean;
  enabledOnly?: boolean;
  workspaceRoot?: string;
}

export interface ListRunsOptions {
  specId?: string;
  status?: RunStatus;
  limit?: number;
}

export interface AutomationServeOptions {
  dbPath?: string;
  workspaceRoot?: string;
  /** Watch/reconcile this specs directory (default: workspace/.mitii/cron). */
  specsDir?: string;
  pollIntervalMs?: number;
  claimLeaseSeconds?: number;
  globalMaxConcurrency?: number;
  autoReconcile?: boolean;
  /** When set, start HTTP ingress on this port (Phase 2). */
  webhookPort?: number;
  webhookHost?: string;
  webhookToken?: string;
  /** GitHub X-Hub-Signature-256 secret for /hooks/github. */
  githubWebhookSecret?: string;
}
