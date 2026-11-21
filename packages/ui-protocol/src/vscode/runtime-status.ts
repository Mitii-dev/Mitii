import { z } from 'zod';

/** Per-source estimated tokens for the last composed prompt / context window. */
export const ContextUsageSliceSchema = z.object({
  id: z.string(),
  label: z.string(),
  tokens: z.number(),
  /** Whether this source contributed to the last run. */
  active: z.boolean(),
});
export type ContextUsageSlice = z.infer<typeof ContextUsageSliceSchema>;

export const ContextUsageNodeKindSchema = z.enum([
  'output',
  'tools',
  'usable',
  'section',
  'source',
  'free',
]);

/**
 * Hierarchical window-budget node for the chat token meter.
 * Parents mirror WindowPolicy / PromptBudget; children are host sources.
 */
export interface ContextUsageNode {
  id: string;
  label: string;
  /** Tokens packed or reserved for this node. */
  usedTokens: number;
  /** Budget ceiling when known. */
  allocatedTokens?: number | undefined;
  omittedTokens?: number | undefined;
  truncatedTokens?: number | undefined;
  kind: z.infer<typeof ContextUsageNodeKindSchema>;
  active: boolean;
  children?: ContextUsageNode[] | undefined;
}

export const ContextUsageNodeSchema: z.ZodType<ContextUsageNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    usedTokens: z.number(),
    allocatedTokens: z.number().optional(),
    omittedTokens: z.number().optional(),
    truncatedTokens: z.number().optional(),
    kind: ContextUsageNodeKindSchema,
    active: z.boolean(),
    children: z.array(ContextUsageNodeSchema).optional(),
  }),
);

export const ContextUsageBreakdownSchema = z.object({
  /** Flat host-source list (backward compatible). */
  slices: z.array(ContextUsageSliceSchema),
  /** Window tree: Output → Tools → Usable → sections → host sources. */
  tree: z.array(ContextUsageNodeSchema).optional(),
  totalTokens: z.number(),
  contextWindow: z.number(),
  /** Share of window used by packed input (0–1). */
  fillRatio: z.number(),
  estimated: z.boolean(),
  /** How the tree was produced. */
  source: z.enum(['host_estimate', 'prompt_budget']).optional(),
  updatedAt: z.string().optional(),
});
export type ContextUsageBreakdown = z.infer<typeof ContextUsageBreakdownSchema>;

export const ProviderSettingsSnapshotSchema = z.object({
  type: z.string(),
  /** Preset id (ollama, openai, openrouter, …). */
  preset: z.string().optional(),
  baseUrl: z.string(),
  model: z.string(),
  hasApiKey: z.boolean(),
  /** Discovered + preset model ids for the dropdown. */
  availableModels: z.array(z.string()),
  /** Stored context window. 0 means use the model preset. */
  contextWindow: z.number(),
  /** Resolved window used at runtime when contextWindow is 0. */
  effectiveContextWindow: z.number().optional(),
  /** Max tokens the model may generate per call. */
  maximumOutputTokens: z.number(),
  connectionOk: z.boolean().optional(),
  connectionStatus: z.string().optional(),
});
export type ProviderSettingsSnapshot = z.infer<
  typeof ProviderSettingsSnapshotSchema
>;

export const AutocompleteAuthHeaderSchema = z.enum([
  'authorization',
  'api-key',
  'x-api-key',
]);
export type AutocompleteAuthHeader = z.infer<
  typeof AutocompleteAuthHeaderSchema
>;

export const AutocompleteSettingsSnapshotSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('openai-compatible'),
  baseUrl: z.string(),
  model: z.string(),
  endpointPath: z.string(),
  authHeader: AutocompleteAuthHeaderSchema,
  maxTokens: z.number(),
  debounceMs: z.number(),
  timeoutMs: z.number(),
  prefixChars: z.number(),
  suffixChars: z.number(),
  temperature: z.number(),
});
export type AutocompleteSettingsSnapshot = z.infer<
  typeof AutocompleteSettingsSnapshotSchema
>;

/** Web search provider settings (SearXNG URL + optional Brave key status). */
export const SearchSettingsSnapshotSchema = z.object({
  /** Preferred free SearXNG base URL (empty = use env / Brave / Tavily). */
  searxngBaseUrl: z.string(),
  /** True when SecretStorage or env has a Brave/Mitii search API key. */
  hasApiKey: z.boolean(),
});
export type SearchSettingsSnapshot = z.infer<
  typeof SearchSettingsSnapshotSchema
>;

export const TokenUsageTurnSchema = z.object({
  turnIndex: z.number(),
  at: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheHitTokens: z.number().optional(),
  cacheMissTokens: z.number().optional(),
  finishReason: z.string().optional(),
  truncated: z.boolean().optional(),
  estimated: z.boolean().optional(),
});
export type TokenUsageTurn = z.infer<typeof TokenUsageTurnSchema>;

export const TokenUsageSnapshotSchema = z.object({
  sessionTotal: z.number(),
  inputTokensTotal: z.number(),
  outputTokensTotal: z.number(),
  currentTurnTotal: z.number(),
  currentTurnInputTokens: z.number(),
  currentTurnOutputTokens: z.number(),
  aiCallCount: z.number(),
  modelCalls: z.number(),
  toolCalls: z.number(),
  loopIterations: z.number(),
  lastPromptTokens: z.number(),
  lastResponseTokens: z.number(),
  turnCount: z.number(),
  contextWindow: z.number(),
  estimated: z.boolean(),
  durationMs: z.number().optional(),
  /** Cumulative prompt-cache hits when the provider reports them. */
  cacheHitTokens: z.number().optional(),
  /** Cumulative prompt-cache misses when reported. */
  cacheMissTokens: z.number().optional(),
  /** Per model-call I/O within the session (live during a run). */
  turns: z.array(TokenUsageTurnSchema),
  live: z.boolean().optional(),
  /** Last prompt context breakdown (window tree + host sources). */
  contextBreakdown: ContextUsageBreakdownSchema.optional(),
});
export type TokenUsageSnapshot = z.infer<typeof TokenUsageSnapshotSchema>;

export const SemanticIndexSourceSchema = z.enum([
  'bundled',
  'ollama',
  'openai-compatible',
  'disabled',
]);
export type SemanticIndexSource = z.infer<typeof SemanticIndexSourceSchema>;

const PipelineStatusSchema = z.object({
  status: z.string(),
  reason: z.string().optional(),
  revision: z.string().optional(),
});

export const IndexPipelineHealthSchema = z.object({
  overall: z.string(),
  running: z.boolean().optional(),
  pipelines: z.object({
    codeIndex: PipelineStatusSchema,
    textFts: PipelineStatusSchema,
    embeddings: z.object({
      status: z.string(),
      reason: z.string().optional(),
      profileId: z.string().optional(),
    }),
    graph: z.object({ status: z.string(), reason: z.string().optional() }),
    map: z.object({ status: z.string(), reason: z.string().optional() }),
    treeSitter: z.object({
      status: z.string(),
      reason: z.string().optional(),
    }),
  }),
  native: z.object({
    sqlite: z.string(),
    lancedb: z.string(),
    onnx: z.string(),
  }),
  lastError: z.string().optional(),
});

export const IndexStatusSnapshotSchema = z.object({
  discoveredFileCount: z.number().optional(),
  progressStage: z.string().optional(),
  fileCount: z.number(),
  truncated: z.boolean(),
  maximumIndexFiles: z.number().optional(),
  scanCompleteness: z.string().optional(),
  cleanupAllowed: z.boolean().optional(),
  rootCount: z.number().optional(),
  indexMode: z.enum(['full', 'host_snapshot']).optional(),
  capabilities: z
    .array(
      z.object({
        capability: z.string(),
        status: z.string(),
        reasonCode: z.string().optional(),
        rootId: z.string().optional(),
        revision: z.string().optional(),
        profile: z.string().optional(),
      }),
    )
    .optional(),
  readiness: z.string().optional(),
  stateTokenPreview: z.string().optional(),
  lastIndexedAt: z.string().optional(),
  message: z.string().optional(),
  embeddingSource: SemanticIndexSourceSchema.optional(),
  embeddingModel: z.string().optional(),
  embeddingEnabled: z.boolean().optional(),
  /** Shared Code/FTS/Embeddings pipeline board from @mitii/host. */
  pipelineHealth: IndexPipelineHealthSchema.optional(),
});
export type IndexStatusSnapshot = z.infer<typeof IndexStatusSnapshotSchema>;

export const WorkspaceSnapshotInfoSchema = z.object({
  root: z.string().optional(),
  rootOverride: z.string().optional(),
  displayRoot: z.string().optional(),
});
export type WorkspaceSnapshotInfo = z.infer<typeof WorkspaceSnapshotInfoSchema>;

export const WorkspaceNoticeViewSchema = z.object({
  isTrusted: z.boolean(),
  notice: z.string().nullable(),
});
export type WorkspaceNoticeView = z.infer<typeof WorkspaceNoticeViewSchema>;
