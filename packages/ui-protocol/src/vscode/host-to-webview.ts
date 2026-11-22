import { z } from 'zod';

import {
  AgentUiModeSchema,
  ContextPinSourceSchema,
  McpRuntimeStatusSchema,
  McpServerConfigSchema,
  McpSettingsSchema,
  PathSuggestionSchema,
  SettingsTabSchema,
  UiNavSchema,
} from './primitives.js';
import {
  ActivityEventPayloadSchema,
  AutomationRunViewSchema,
  AutomationSpecViewSchema,
  ChatMessageViewSchema,
  ChatThreadSummarySchema,
  CheckpointItemViewSchema,
  MemoryItemViewSchema,
  PlanViewSchema,
  ReviewDiffViewSchema,
  ReviewFindingViewSchema,
  RunFileChangesViewSchema,
  RunUsagePayloadSchema,
  SkillCatalogItemSchema,
  SuspensionPayloadSchema,
} from './run-views.js';
import {
  AutocompleteSettingsSnapshotSchema,
  IndexStatusSnapshotSchema,
  ProviderSettingsSnapshotSchema,
  SearchSettingsSnapshotSchema,
  TokenUsageSnapshotSchema,
  WorkspaceNoticeViewSchema,
  WorkspaceSnapshotInfoSchema,
} from './runtime-status.js';
import {
  SettingsProfileViewSchema,
  UiSettingsSnapshotSchema,
} from './ui-settings.js';

export const ModelPricingRatesSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  reasoning: z.number().optional(),
});
export type ModelPricingRates = z.infer<typeof ModelPricingRatesSchema>;

/** Host → webview messages. */
export const HostToWebviewMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bootstrap'),
    workspace: WorkspaceSnapshotInfoSchema,
    provider: ProviderSettingsSnapshotSchema,
    autocomplete: AutocompleteSettingsSnapshotSchema,
    search: SearchSettingsSnapshotSchema,
    profiles: z.array(SettingsProfileViewSchema),
    activeProfileId: z.string(),
    index: IndexStatusSnapshotSchema,
    mcp: McpSettingsSchema,
    mcpRuntimeStatus: McpRuntimeStatusSchema,
    /** Built-in MCP catalog available to install (not auto-installed). */
    mcpStore: z.array(McpServerConfigSchema),
    ui: UiSettingsSnapshotSchema,
    tokenUsage: TokenUsageSnapshotSchema,
    notice: WorkspaceNoticeViewSchema,
    onboardingRequired: z.boolean(),
    history: z.array(ChatThreadSummarySchema),
    activeThreadId: z.string().optional(),
    activeThreadMessages: z.array(ChatMessageViewSchema).optional(),
    /** Pending plan awaiting Agent-mode handoff for the active thread. */
    pendingPlan: PlanViewSchema.nullable().optional(),
    memories: z.array(MemoryItemViewSchema),
    checkpoints: z.array(CheckpointItemViewSchema),
  }),
  z.object({
    type: z.literal('settings'),
    provider: ProviderSettingsSnapshotSchema,
    autocomplete: AutocompleteSettingsSnapshotSchema,
    search: SearchSettingsSnapshotSchema,
    profiles: z.array(SettingsProfileViewSchema),
    activeProfileId: z.string(),
    ui: UiSettingsSnapshotSchema,
    workspace: WorkspaceSnapshotInfoSchema,
    mcp: McpSettingsSchema,
    mcpRuntimeStatus: McpRuntimeStatusSchema,
    mcpStore: z.array(McpServerConfigSchema),
    tokenUsage: TokenUsageSnapshotSchema,
    notice: WorkspaceNoticeViewSchema,
  }),
  z.object({
    type: z.literal('settings.saved'),
    ok: z.boolean(),
    message: z.string().optional(),
  }),
  z.object({ type: z.literal('index.status'), index: IndexStatusSnapshotSchema }),
  z.object({
    type: z.literal('provider.connectionResult'),
    ok: z.boolean(),
    message: z.string(),
    models: z.array(z.string()).optional(),
    testing: z.boolean().optional(),
  }),
  z.object({ type: z.literal('provider.models'), models: z.array(z.string()) }),
  z.object({ type: z.literal('tokenUsage'), usage: TokenUsageSnapshotSchema }),
  z.object({
    type: z.literal('modelPricing'),
    rates: ModelPricingRatesSchema.nullable(),
  }),
  z.object({
    type: z.literal('run.started'),
    mode: AgentUiModeSchema,
    prompt: z.string(),
  }),
  z.object({ type: z.literal('run.event'), event: ActivityEventPayloadSchema }),
  z.object({ type: z.literal('run.delta'), text: z.string() }),
  z.object({
    type: z.literal('run.suspended'),
    suspension: SuspensionPayloadSchema,
  }),
  z.object({ type: z.literal('run.resumed'), runId: z.string() }),
  z.object({
    type: z.literal('run.result'),
    status: z.string(),
    answer: z.string().optional(),
    route: z.string().nullable().optional(),
    error: z.string().optional(),
    usage: RunUsagePayloadSchema.optional(),
    plan: PlanViewSchema.nullable().optional(),
    /** Explicit pending-plan handoff state for the active thread. */
    pendingPlan: PlanViewSchema.nullable().optional(),
  }),
  z.object({ type: z.literal('run.cancelled') }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({
    type: z.literal('paths.results'),
    requestId: z.string(),
    suggestions: z.array(PathSuggestionSchema),
  }),
  z.object({
    type: z.literal('openSettings'),
    tab: SettingsTabSchema.optional(),
  }),
  z.object({ type: z.literal('setTab'), tab: UiNavSchema }),
  /** Run a working-tree review via the Review button (not a chat mode). */
  z.object({
    type: z.literal('startReview'),
    autoRun: z.boolean().optional(),
    prompt: z.string().optional(),
  }),
  z.object({
    type: z.literal('editorPin'),
    path: z.string(),
    source: ContextPinSourceSchema.optional(),
  }),
  z.object({ type: z.literal('editorUnpin'), path: z.string() }),
  z.object({ type: z.literal('syncAutoPins'), paths: z.array(z.string()) }),
  z.object({
    type: z.literal('run.fileChanges'),
    changes: RunFileChangesViewSchema,
  }),
  z.object({
    type: z.literal('fileChanges.undone'),
    runId: z.string(),
    restored: z.array(z.string()),
  }),
  z.object({
    type: z.literal('workspaceNotice'),
    notice: WorkspaceNoticeViewSchema,
  }),
  z.object({
    type: z.literal('history'),
    threads: z.array(ChatThreadSummarySchema),
    activeThreadId: z.string().optional(),
  }),
  z.object({
    type: z.literal('thread.loaded'),
    threadId: z.string(),
    messages: z.array(ChatMessageViewSchema),
    /** Pending plan awaiting Agent-mode handoff for this thread. */
    pendingPlan: PlanViewSchema.nullable().optional(),
  }),
  z.object({ type: z.literal('setPlan'), plan: PlanViewSchema.nullable() }),
  z.object({
    type: z.literal('setReviewDiff'),
    review: ReviewDiffViewSchema.nullable(),
  }),
  z.object({
    type: z.literal('setReviewFindings'),
    findings: z.array(ReviewFindingViewSchema),
  }),
  z.object({
    type: z.literal('setMemories'),
    memories: z.array(MemoryItemViewSchema),
  }),
  z.object({
    type: z.literal('setCheckpoints'),
    checkpoints: z.array(CheckpointItemViewSchema),
  }),
  z.object({
    type: z.literal('skillCatalogResult'),
    requestId: z.string(),
    items: z.array(SkillCatalogItemSchema),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('automationsResult'),
    requestId: z.string(),
    specs: z.array(AutomationSpecViewSchema),
    runs: z.array(AutomationRunViewSchema),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal('onboarding'), required: z.boolean() }),
]);

export type HostToWebviewMessage = z.infer<typeof HostToWebviewMessageSchema>;
