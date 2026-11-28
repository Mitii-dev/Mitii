import { z } from 'zod';

import { AgentUiModeSchema } from './primitives.js';

/** Excalidraw / MCP Apps diagram card shown in the chat timeline. */
export const McpAppViewPayloadSchema = z.object({
  serverId: z.string(),
  tool: z.string(),
  title: z.string(),
  checkpointId: z.string().optional(),
  /** Inline SVG preview (data URL). */
  svgDataUrl: z.string().optional(),
  /** MCP Apps HTML when resources/read succeeded (iframe srcdoc). */
  html: z.string().optional(),
  paths: z.object({
    md: z.string().optional(),
    docsMd: z.string().optional(),
    excalidraw: z.string().optional(),
    svg: z.string().optional(),
  }),
});
export type McpAppViewPayload = z.infer<typeof McpAppViewPayloadSchema>;

export const ActivityEventPayloadSchema = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.enum([
    'thinking',
    'delta',
    'context',
    'tool',
    'decision',
    'warning',
    'suspended',
    'terminal',
    'info',
    'mcp_app',
  ]),
  title: z.string(),
  detail: z.string().optional(),
  status: z.string().optional(),
  mcpApp: McpAppViewPayloadSchema.optional(),
});
export type ActivityEventPayload = z.infer<typeof ActivityEventPayloadSchema>;

export const ClarificationOptionViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type ClarificationOptionView = z.infer<
  typeof ClarificationOptionViewSchema
>;

export const PlanStepViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'active', 'done', 'skipped']),
  detail: z.string().optional(),
  riskLevel: z.string().optional(),
  targetRefs: z.array(z.string()).optional(),
  expectedOutcome: z.string().optional(),
  verification: z.string().optional(),
});
export type PlanStepView = z.infer<typeof PlanStepViewSchema>;

export const PlanPhaseViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().optional(),
  steps: z.array(PlanStepViewSchema),
});
export type PlanPhaseView = z.infer<typeof PlanPhaseViewSchema>;

export const PlanRiskViewSchema = z.object({
  id: z.string(),
  summary: z.string(),
  severity: z.string().optional(),
  mitigation: z.string().optional(),
});
export type PlanRiskView = z.infer<typeof PlanRiskViewSchema>;

export const PlanDimensionsViewSchema = z.object({
  scope: z.string(),
  risk: z.string(),
  clarity: z.string(),
  complexity: z.string(),
});
export type PlanDimensionsView = z.infer<typeof PlanDimensionsViewSchema>;

export const PlanViewSchema = z.object({
  title: z.string(),
  /** Flat steps kept for back-compat with older UI/history. */
  steps: z.array(PlanStepViewSchema),
  objective: z.string().optional(),
  dimensions: PlanDimensionsViewSchema.optional(),
  phases: z.array(PlanPhaseViewSchema).optional(),
  risks: z.array(PlanRiskViewSchema).optional(),
  openQuestions: z.array(z.string()).optional(),
  verificationSummary: z.string().optional(),
  /** Workspace-relative path to the saved markdown plan under `.mitii/plans/`. */
  savedPlanPath: z.string().optional(),
});
export type PlanView = z.infer<typeof PlanViewSchema>;

export const SuspensionPayloadSchema = z.object({
  runId: z.string(),
  kind: z.enum([
    'clarification_required',
    'approval_required',
    'plan_approval_required',
    'grant_expansion_required',
    'continue_required',
  ]),
  rationale: z.string().optional(),
  clarificationPrompt: z.string().optional(),
  /** Why clarification_required fired (hollow_plan, scope_fork, …). */
  clarifyOrigin: z.string().optional(),
  clarificationOptions: z.array(ClarificationOptionViewSchema).optional(),
  /** Structured plan awaiting approval (plan_approval_required). */
  plan: PlanViewSchema.nullable().optional(),
  /** Plain-text plan/answer shown while a plan approval is suspended. */
  planText: z.string().optional(),
  approval: z
    .object({
      approvalId: z.string(),
      toolName: z.string(),
      paths: z.array(z.string()).optional(),
      proposedText: z.string().optional(),
      arguments: z.unknown().optional(),
    })
    .optional(),
  grantExpansion: z
    .object({
      expansionId: z.string(),
      extraPaths: z.array(z.string()),
      currentPathScopes: z.array(z.string()).optional(),
    })
    .optional(),
  continuePrompt: z.string().optional(),
});
export type SuspensionPayload = z.infer<typeof SuspensionPayloadSchema>;

export const RunUsagePayloadSchema = z.object({
  modelCalls: z.number(),
  toolCalls: z.number(),
  loopIterations: z.number(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  durationMs: z.number(),
});
export type RunUsagePayload = z.infer<typeof RunUsagePayloadSchema>;

export const ReviewDiffViewSchema = z.object({
  summary: z.string(),
  files: z.array(z.object({ path: z.string(), status: z.string() })),
  patchPreview: z.string().optional(),
});
export type ReviewDiffView = z.infer<typeof ReviewDiffViewSchema>;

/** Per-file stats for an agent run's mutations. */
export const FileChangeEntryViewSchema = z.object({
  path: z.string(),
  additions: z.number(),
  deletions: z.number(),
  status: z.enum(['A', 'M', 'D', '?']),
  /** Truncated unified-diff style preview. */
  patchPreview: z.string().optional(),
  /** True when the path was already dirty before the run started. */
  wasPreDirty: z.boolean().optional(),
});
export type FileChangeEntryView = z.infer<typeof FileChangeEntryViewSchema>;

/** Summary of files this agent run changed. */
export const RunFileChangesViewSchema = z.object({
  runId: z.string(),
  files: z.array(FileChangeEntryViewSchema),
  totalAdditions: z.number(),
  totalDeletions: z.number(),
  /** Count of pre-existing dirty files left untouched. */
  leftUntouchedPreDirty: z.number().optional(),
});
export type RunFileChangesView = z.infer<typeof RunFileChangesViewSchema>;

export const ChatThreadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  messageCount: z.number(),
});
export type ChatThreadSummary = z.infer<typeof ChatThreadSummarySchema>;

export const ChatMessageViewSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  mode: AgentUiModeSchema.optional(),
  /** Compact activity timeline for restore after reload (assistant turns). */
  activity: z.array(ActivityEventPayloadSchema).optional(),
  /** File mutations from this turn, restored with the message. */
  fileChanges: RunFileChangesViewSchema.optional(),
  status: z.string().optional(),
  route: z.string().nullable().optional(),
});
export type ChatMessageView = z.infer<typeof ChatMessageViewSchema>;

export const MemoryItemViewSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
export type MemoryItemView = z.infer<typeof MemoryItemViewSchema>;

export const CheckpointItemViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
  changedPaths: z.array(z.string()).optional(),
});
export type CheckpointItemView = z.infer<typeof CheckpointItemViewSchema>;

export const SkillCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
});
export type SkillCatalogItem = z.infer<typeof SkillCatalogItemSchema>;

export const AutomationSpecViewSchema = z.object({
  specId: z.string(),
  title: z.string(),
  enabled: z.boolean(),
  triggerKind: z.string(),
  scheduleExpr: z.string().nullable().optional(),
  eventType: z.string().nullable().optional(),
  nextRunAt: z.string().nullable().optional(),
  autonomyPreset: z.string().nullable().optional(),
});
export type AutomationSpecView = z.infer<typeof AutomationSpecViewSchema>;

export const AutomationRunViewSchema = z.object({
  runId: z.string(),
  specId: z.string(),
  status: z.string(),
  createdAt: z.string(),
  error: z.string().nullable().optional(),
});
export type AutomationRunView = z.infer<typeof AutomationRunViewSchema>;

export const ReviewFindingViewSchema = z.object({
  path: z.string(),
  content: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  severity: z.string(),
  category: z.string().optional(),
  existingCode: z.string().optional(),
  suggestionCode: z.string().optional(),
  status: z.enum(['open', 'fixed']).optional(),
});
export type ReviewFindingView = z.infer<typeof ReviewFindingViewSchema>;
