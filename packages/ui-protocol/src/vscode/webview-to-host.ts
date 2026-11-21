import { z } from 'zod';

import {
  AgentUiDepthSchema,
  AgentUiEffortSchema,
  AgentUiModeSchema,
  ContextToggleKeySchema,
  LoopBandIdSchema,
  McpSettingsSchema,
  SettingsTabSchema,
  UiNavSchema,
} from './primitives.js';
import {
  AutocompleteSettingsSnapshotSchema,
  ProviderSettingsSnapshotSchema,
  SearchSettingsSnapshotSchema,
  SemanticIndexSourceSchema,
} from './runtime-status.js';
import {
  PolicyLabSettingsSnapshotSchema,
  SettingsProfileViewSchema,
  UiSettingsPatchSchema,
} from './ui-settings.js';

const id = z.string();
const path = z.string();

const settingsSetProviderSchema = ProviderSettingsSnapshotSchema.pick({
  type: true,
  preset: true,
  baseUrl: true,
  model: true,
  contextWindow: true,
  maximumOutputTokens: true,
}).partial();

/**
 * Webview → host messages. The host MUST parse every inbound message with
 * {@link WebviewToHostMessageSchema} before dispatch.
 */
export const WebviewToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('navigate'),
    nav: UiNavSchema,
    settingsTab: SettingsTabSchema.optional(),
  }),
  z.object({ type: z.literal('setTab'), tab: UiNavSchema }),
  z.object({
    type: z.literal('ask'),
    prompt: z.string(),
    mode: AgentUiModeSchema,
    depth: AgentUiDepthSchema.optional(),
    effort: AgentUiEffortSchema.optional(),
    approvalMode: z.string().optional(),
    pinnedPaths: z.array(path).optional(),
    requiredSkillIds: z.array(id).optional(),
    /** Attached MCP server ids for this turn (@mcp: / pin chips). */
    requiredMcpServerIds: z.array(id).optional(),
    /** Review mode: `changes` = quick diff scan (default); `code` = thorough pass. */
    reviewKind: z.enum(['changes', 'code']).optional(),
  }),
  z.object({ type: z.literal('cancel') }),
  z.object({
    type: z.literal('resume'),
    runId: id,
    clarificationAnswer: z.string().optional(),
    approval: z
      .object({
        approvalId: id,
        decision: z.enum(['approved', 'denied']),
      })
      .optional(),
    planDecision: z
      .object({ decision: z.enum(['approved', 'rejected', 'edited']) })
      .optional(),
    grantExpansion: z
      .object({
        expansionId: id,
        decision: z.enum(['approved', 'denied']),
      })
      .optional(),
    continueDecision: z
      .object({
        decision: z.enum(['continue', 'stop']),
        /** Optional redirect hint when continuing after a zero-progress stall. */
        guidance: z.string().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal('newChat') }),
  z.object({ type: z.literal('openChatThread'), id }),
  z.object({ type: z.literal('deleteChatThread'), id }),
  z.object({ type: z.literal('clearChatHistory') }),
  z.object({ type: z.literal('completeOnboarding') }),
  z.object({ type: z.literal('showInlineDiff'), approvalId: id }),
  z.object({
    type: z.literal('openDiffPreview'),
    path,
    proposedText: z.string().optional(),
    oldText: z.string().optional(),
  }),
  z.object({
    type: z.literal('toggleContextSource'),
    source: ContextToggleKeySchema,
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal('refreshReviewDiff') }),
  z.object({ type: z.literal('restoreCheckpoint'), id }),
  z.object({ type: z.literal('deleteCheckpoint'), id }),
  z.object({ type: z.literal('clearCheckpoints') }),
  z.object({ type: z.literal('reviewCheckpointChanges'), id }),
  z.object({ type: z.literal('addMemory'), text: z.string() }),
  z.object({ type: z.literal('deleteMemory'), id }),
  z.object({ type: z.literal('clearMemory') }),
  z.object({
    type: z.literal('requestSkillCatalog'),
    requestId: id,
    query: z.string().optional(),
  }),
  z.object({ type: z.literal('requestAutomations'), requestId: id }),
  z.object({ type: z.literal('automation.trigger'), specId: id }),
  z.object({ type: z.literal('automation.pause'), specId: id }),
  z.object({ type: z.literal('automation.resume'), specId: id }),
  z.object({ type: z.literal('pickContextPath') }),
  z.object({ type: z.literal('copyLastResponse') }),
  z.object({ type: z.literal('approveAllPending') }),
  z.object({ type: z.literal('settings.get') }),
  z.object({
    type: z.literal('settings.set'),
    provider: settingsSetProviderSchema.optional(),
    autocomplete: AutocompleteSettingsSnapshotSchema.partial().optional(),
    search: SearchSettingsSnapshotSchema.pick({ searxngBaseUrl: true })
      .partial()
      .optional(),
    ui: UiSettingsPatchSchema.optional(),
    workspaceRootOverride: z.string().nullable().optional(),
    mcp: McpSettingsSchema.optional(),
    approvalMode: z.string().optional(),
    workspaceMaximumIndexFiles: z.number().optional(),
    profile: SettingsProfileViewSchema.optional(),
    semanticIndex: z
      .object({ source: SemanticIndexSourceSchema.optional() })
      .optional(),
  }),
  z.object({ type: z.literal('settings.setApiKey') }),
  z.object({ type: z.literal('settings.clearApiKey') }),
  z.object({ type: z.literal('settings.setSearchApiKey') }),
  z.object({ type: z.literal('settings.clearSearchApiKey') }),
  z.object({ type: z.literal('settings.resetTokenBudget') }),
  z.object({ type: z.literal('settings.resetLoopPolicy') }),
  z.object({ type: z.literal('settings.resetV8LoopPolicy') }),
  z.object({
    type: z.literal('settings.savePolicyLab'),
    policyLab: PolicyLabSettingsSnapshotSchema,
  }),
  z.object({
    type: z.literal('settings.setPolicyLabEditBand'),
    band: LoopBandIdSchema,
    /** Carry draft maps so switching bands does not lose unsaved edits. */
    policyLab: PolicyLabSettingsSnapshotSchema.optional(),
  }),
  z.object({ type: z.literal('profile.switch'), id }),
  z.object({
    type: z.literal('provider.testConnection'),
    provider: z.object({
      type: z.string(),
      baseUrl: z.string(),
      model: z.string(),
    }),
  }),
  z.object({
    type: z.literal('provider.listModels'),
    provider: z.object({ type: z.string(), baseUrl: z.string() }),
  }),
  z.object({ type: z.literal('index.refresh') }),
  z.object({ type: z.literal('index.reindex') }),
  z.object({
    type: z.literal('paths.search'),
    query: z.string(),
    requestId: id,
  }),
  z.object({ type: z.literal('openFolder') }),
  z.object({
    type: z.literal('openFile'),
    path,
    line: z.number().optional(),
    column: z.number().optional(),
  }),
  z.object({ type: z.literal('undoFileChanges'), runId: id }),
  z.object({ type: z.literal('reviewFileChange'), runId: id, path }),
  z.object({ type: z.literal('reviewWorkspaceFile'), path }),
  z.object({ type: z.literal('dismissFileChanges'), runId: id }),
  /** Clear Mitii review findings (Problems + comment threads + chat chips). */
  z.object({ type: z.literal('dismissReviewFindings') }),
  /**
   * Start Agent with the fix-review-findings host recipe.
   * Uses the host finding store (full anchors); indices select a subset.
   */
  z.object({
    type: z.literal('fixReviewFindings'),
    /** Indices into the current review finding list; omit = all. */
    indices: z.array(z.number()).optional(),
    /** Optional Mitii run id — opens before/after patch preview for the first path. */
    runId: z.string().optional(),
  }),
  /** Drop the active thread's pending plan without starting a run. */
  z.object({ type: z.literal('clearPendingPlan') }),
]);

export type WebviewToHostMessage = z.infer<typeof WebviewToHostMessageSchema>;
