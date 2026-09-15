/**
 * @mitii/host — shared host kit for Mitii apps (CLI + VS Code).
 *
 * Dependency direction:
 *   apps → @mitii/host → @mitii/sdk → @mitii/v8
 *
 * This package owns host-side adapters and orchestration that must not live in
 * V8 or the SDK: SQLite injection, workspace indexing, durable FS stores,
 * optional SearchPort / content-aware NetworkPort (@mitii/search-kit), disk skills,
 * project rules, and provider presets.
 *
 * Public surface is grouped below by intent. Prefer importing from `@mitii/host`
 * (this barrel). Apps inject environment-specific pieces (SQLite opener,
 * secrets, settings resolution); everything else is shared here.
 */

// ---------------------------------------------------------------------------
// SQLite injection contract
// ---------------------------------------------------------------------------
// Hosts supply `openDatabase` so Electron-native bindings stay in VS Code
// while CLI uses better-sqlite3. Indexing + repository-context require this.
export type {
  HostSqliteDatabase,
  HostSqliteOpenOptions,
  OpenHostSqliteDatabase,
} from './sqlite/types.js';

// ---------------------------------------------------------------------------
// Indexing — turn a workspace into durable .mitii artifacts
// ---------------------------------------------------------------------------
export {
  OpenAiCompatibleEmbeddingProvider,
  createHostEmbeddingProvider,
  resolveHostEmbeddingProvider,
  createLanceDbConnection,
  probeEmbeddingProvider,
  writeIndexRuntimeMetadata,
  readIndexRuntimeMetadata,
  normalizePositiveInteger,
  resolveDefaultEmbeddingPreset,
  shouldEnableSemanticIndex,
  alignSemanticSettingsWithPersistedProfile,
  normalizeEmbeddingRequestBaseUrl,
  EMBEDDING_PRESETS,
  DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OLLAMA_EMBEDDING_DIMENSIONS,
} from './indexing/semanticIndex.js';
export type {
  EmbeddingBackend,
  EmbeddingSource,
  EmbeddingPreset,
  EmbeddingPresetId,
  EmbeddingProbeResult,
  SemanticIndexSettings,
  SemanticIndexEnablementOptions,
  IndexRuntimeMetadata,
} from './indexing/semanticIndex.js';
export {
  BUNDLED_MINILM_CATALOG,
  BUNDLED_MINILM_DIMENSIONS,
  BUNDLED_MINILM_ID,
  BUNDLED_MINILM_MODEL_ID,
  BUNDLED_MINILM_PRESET,
  DEFAULT_EMBEDDING_SOURCE,
  ONNX_NATIVE_TARGETS,
  createBundledMiniLmEmbeddingProvider,
  defaultBundledModelsDirectory,
  resolveEmbeddingSource,
  EmbeddingSourceResolutionInputSchema,
  EmbeddingSourceResolutionSchema,
  EmbeddingSourceSchema,
} from './indexing/bundled-embedding/index.js';
export type {
  EmbeddingSourceResolution,
  EmbeddingSourceResolutionInput,
} from './indexing/bundled-embedding/index.js';

export {
  runFullWorkspaceIndex,
} from './indexing/fullWorkspaceIndex.js';
export type {
  FullWorkspaceIndexResult,
  WorkspaceIndexProgress,
  WorkspaceIndexProgressStage,
} from './indexing/fullWorkspaceIndex.js';
export {
  IndexLockedError,
  acquireIndexLock,
  INDEX_LOCK_FILE,
  INDEX_LOCK_STALE_MS,
} from './indexing/indexLock.js';
export {
  DEFAULT_MAXIMUM_INDEX_FILES,
  MAXIMUM_INDEX_FILES,
  resolveMaximumIndexFiles,
} from './indexing/indexLimits.js';
export { isSecurityConcern, WorkspaceIgnorePolicy, WS_CONSTANTS } from '@mitii/v8';

export {
  WEB_TREE_SITTER_GRAMMAR_WASM_BY_LANGUAGE,
  WebTreeSitterRuntime,
  resolveTreeSitterPackageAsset,
} from './indexing/treeSitter/WebTreeSitterRuntime.js';
export type {
  WebTreeSitterRuntimeOptions,
} from './indexing/treeSitter/WebTreeSitterRuntime.js';
export {
  createDefaultTreeSitterRuntime,
} from './indexing/treeSitter/createDefaultTreeSitterRuntime.js';

/**
 * Fingerprint-only publish candidate (honest: indexes unavailable).
 * Not the V8 `WorkspaceSnapshot` artifact used by indexing/retrieval.
 */
export { buildWorkspaceSnapshot, resolveFingerprintRootId, enrichFingerprintWithPersistedVectorProfile } from './indexing/fingerprintSnapshot.js';
export type {
  WorkspaceSnapshot,
  WorkspaceSnapshotOptions,
} from './indexing/fingerprintSnapshot.js';

// ---------------------------------------------------------------------------
// Repository context — hybrid retrieval over published state (+ file-map fallback)
// ---------------------------------------------------------------------------
export { createHostRepositoryContext } from './repository-context/createHostRepositoryContext.js';
export type {
  HostEditorContextReferences,
} from './repository-context/createHostRepositoryContext.js';

export { createHostCodeNavigationPort } from './code-navigation/createHostCodeNavigationPort.js';
export {
  createHostRepositoryGraphPort,
  loadWorkspaceGraphs,
  resolveExpectedCodeIndexChangeToken,
  workspaceGraphLooksStale,
  WORKSPACE_DIRTY_CHANGE_TOKEN_SUFFIX,
} from './repository-graph/loadWorkspaceGraphs.js';

// ---------------------------------------------------------------------------
// Port adapters — satisfy V8/SDK injection points with FS / vendor code
// ---------------------------------------------------------------------------
export { createWorkspaceCheckpointStore } from './ports/checkpoints.js';
export { createWorkspaceVerificationStore } from './ports/verificationRecords.js';
export { createWorkspaceReviewStore } from './ports/reviewRecords.js';

export {
  createWorkspaceMemoryStore,
  FileWorkspaceMemoryStore,
} from './ports/memoryStore.js';
export type { MemoryDeleteResult } from './ports/memoryStore.js';
export {
  createWorkspaceKnowledgeGraph,
  FileWorkspaceKnowledgeGraphStore,
} from './ports/knowledgeGraphStore.js';
export { observeWorkspaceEvent } from './ports/memoryCapture.js';
export type {
  ObserveWorkspaceEventInput,
  ObserveWorkspaceEventResult,
} from './ports/memoryCapture.js';
export {
  listPendingMemories,
  approvePendingMemory,
  rejectPendingMemory,
  appendPendingMemory,
} from './ports/memoryPending.js';
export type { PendingMemoryDraft } from './ports/memoryPending.js';
export {
  observeRunToolEvent,
  shouldObserveRunEvent,
} from './ports/observeRunEvent.js';
export type {
  MemoryCaptureContext,
  ObservingRunEvent,
} from './ports/observeRunEvent.js';
export { resolveMemoryEmbeddingPort } from './ports/resolveMemoryEmbedding.js';
export {
  FileWorkspaceObservationStore,
  evictOldestObservations,
  MAX_OBSERVATIONS_PER_WORKSPACE,
} from './ports/memoryObservations.js';
export type { MemoryObservation } from './ports/memoryObservations.js';
export {
  createWorkspaceMemoryLeaseStore,
  FileWorkspaceMemoryLeaseStore,
  MEMORY_LEASE_RESOURCES,
} from './ports/memoryLeases.js';
export type {
  MemoryLease,
  MemoryLeaseResource,
  LeaseAcquireResult,
  LeaseReleaseResult,
} from './ports/memoryLeases.js';
export { appendMemoryAudit } from './ports/memoryAudit.js';
export type { MemoryAuditEvent } from './ports/memoryAudit.js';
export { createMemoryEmbeddingPort } from './ports/memoryEmbeddingAdapter.js';

// ---------------------------------------------------------------------------
// Corpus RAG (Phase 4) — optional `.mitii/corpus/` text index + retrieval
// ---------------------------------------------------------------------------
export {
  runCorpusIndex,
  loadCorpusIndex,
  corpusDirectory,
  corpusIndexPath,
  corpusIndexExists,
  CORPUS_DIR_NAME,
  CORPUS_INDEX_FILE,
  CORPUS_INDEX_SCHEMA_VERSION,
} from './corpus/corpusIndex.js';
export type {
  CorpusIndex,
  CorpusFileEntry,
  CorpusChunk,
} from './corpus/corpusIndex.js';
export { CorpusRetrievalSource } from './corpus/CorpusRetrievalSource.js';

// ---------------------------------------------------------------------------
// Child runs (Phase 5) — mode ≤ parent, deny-only safety, worktree path
// ---------------------------------------------------------------------------
export {
  narrowChildStartInput,
  createChildWorktreePath,
} from './runtime/childRuns.js';
export type {
  NarrowChildStartInputParams,
  NarrowedChildStartInput,
} from './runtime/childRuns.js';

export {
  createOptionalSearchPort,
  BraveSearchAdapter,
  SearchKitSearchAdapter,
  resolveSearchKitConfig,
} from './ports/search.js';
export type {
  CreateSearchPortOptions,
  SearchKitConfig,
  ResolveSearchKitConfigOptions,
} from './ports/search.js';
export {
  createHostNetworkPort,
  ContentAwareNetworkAdapter,
} from './ports/network.js';
export type { CreateHostNetworkPortOptions } from './ports/network.js';

export {
  createFileSystemSkillsCatalog,
  loadDiskSkills,
} from './ports/skillsCatalog.js';
export type {
  DiskSkillContentMode,
  DiskSkillManifest,
  LoadDiskSkillsOptions,
} from './ports/skillsCatalog.js';

// ---------------------------------------------------------------------------
// Writing recipes — force-attach bundled skills for commit / PR / changelog
// ---------------------------------------------------------------------------
export {
  MITII_WRITING_RECIPE_IDS,
  MITII_WRITING_RECIPES,
  buildWritingRecipeAsk,
  collectGitWritingContext,
  isMitiiWritingRecipeId,
  resolveMitiiWritingRecipe,
  unwrapRecipeAnswer,
} from './recipes/gitWritingRecipes.js';
export type {
  BuildWritingRecipeAskOptions,
  CommitMessageStyle,
  MitiiWritingRecipe,
  MitiiWritingRecipeId,
  WritingRecipeAsk,
} from './recipes/gitWritingRecipes.js';

export {
  RECIPE_SPEC_SCHEMA_VERSION,
  recipeSpecSchema,
  compileRecipeToStartInput,
  loadRecipeSpec,
  renderRecipePrompt,
  writingRecipeToSpec,
} from './recipes/recipeSpec.js';
export type {
  RecipeSpec,
  CompiledRecipeStart,
  CompileRecipeOptions,
} from './recipes/recipeSpec.js';

// ---------------------------------------------------------------------------
// Prompt helpers — host-owned instruction files → MitiiStartInput.projectRules
// ---------------------------------------------------------------------------
export { loadProjectRules } from './prompt/projectRules.js';
export type {
  LoadProjectRulesOptions,
  ProjectRuleBlock,
} from './prompt/projectRules.js';

// ---------------------------------------------------------------------------
// Diff previews — host-owned proposed edit files under `.mitii/diff-preview`
// ---------------------------------------------------------------------------
export { FileDiffPreviewStore } from './preview/diffPreviewStore.js';
export type {
  DiffPreviewFile,
  PatchDiffPreviewFiles,
} from './preview/diffPreviewStore.js';

// ---------------------------------------------------------------------------
// Config UX — provider presets, LlmPort factory, connection probe
// ---------------------------------------------------------------------------
export {
  PROVIDER_PRESETS,
  getProviderPreset,
  isHostProviderType,
  isLocalBaseUrl,
  isOllamaBaseUrl,
} from './config/providerPresets.js';
export type {
  HostProviderType,
  ProviderPreset,
  ProviderPresetId,
} from './config/providerPresets.js';

export { createHostLlmPorts } from './config/createHostLlmPorts.js';
export type {
  CreateHostLlmPortsInput,
  HostLlmPorts,
} from './config/createHostLlmPorts.js';

export {
  inferHostProviderType,
  resolveProviderApiKey,
} from './config/resolveProviderApiKey.js';

export {
  testProviderConnection,
  listProviderModels,
} from './config/testProviderConnection.js';
export type {
  ProviderConnectionResult,
  TestProviderConnectionInput,
  ListProviderModelsInput,
} from './config/testProviderConnection.js';

// ---------------------------------------------------------------------------
// Automation (Phase 1) — SDK executor for @mitii/automation ClaimRunner
// ---------------------------------------------------------------------------
export { createAutomationRunExecutor } from './automation/createAutomationRunExecutor.js';
export type { CreateAutomationRunExecutorOptions } from './automation/createAutomationRunExecutor.js';
export {
  MEMORY_CONSOLIDATE_SCHEDULE_NAME,
  MEMORY_CONSOLIDATE_SCHEDULE_PROMPT,
  buildMemoryConsolidateScheduleInput,
  runMemoryConsolidateWithLease,
} from './automation/memoryConsolidateRecipe.js';
export { createCompositeDeliverySender } from './automation/delivery/createCompositeDeliverySender.js';
export type { CreateCompositeDeliverySenderOptions } from './automation/delivery/createCompositeDeliverySender.js';
export { formatDeliveryMessage } from './automation/delivery/formatMessage.js';

// ---------------------------------------------------------------------------
// Safety — tighten-only user rules, marketplace-lite, OS sandbox
// ---------------------------------------------------------------------------
export {
  loadUserSafetyRules,
  USER_SAFETY_RULES_FILENAME,
  USER_SAFETY_RULES_EXAMPLE,
} from './safety/loadUserSafetyRules.js';
export {
  MARKETPLACE_LITE_CATALOG,
  listMarketplaceLite,
} from './safety/marketplaceLite.js';
export type { MarketplaceCatalogEntry } from './safety/marketplaceLite.js';
export {
  createSandboxedProcessPort,
  detectSandboxBackend,
  resolveDockerBackend,
  resolveSandboxPolicy,
  SandboxUnavailableError,
} from './sandbox/createSandboxedProcessPort.js';
export type {
  SandboxPolicy,
  SandboxNetworkMode,
  SandboxBackend,
  SandboxBackendPrefer,
} from './sandbox/createSandboxedProcessPort.js';
export {
  resolveSandboxPreset,
  resolveSandboxSettingsFromPreset,
} from './sandbox/resolveSandboxPreset.js';
export type {
  SandboxApprovalPreset,
  SandboxPresetDefaults,
} from './sandbox/resolveSandboxPreset.js';

export {
  loadWorkspaceHooks,
  evaluatePreToolHooks,
  hookSpecSchema,
  SAMPLE_PRE_TOOL_DENY_GIT_PUSH,
  HOOK_SPEC_SCHEMA_VERSION,
} from './hooks/workspaceHooks.js';
export type { HookSpec, LoadedHooks } from './hooks/workspaceHooks.js';

export { createHeuristicAdversary } from './safety/heuristicAdversary.js';
export type { HeuristicAdversaryOptions } from './safety/heuristicAdversary.js';
