/**
 * @mitii/host — shared host kit for Mitii apps (CLI + VS Code).
 *
 * Dependency direction:
 *   apps → @mitii/host → @mitii/sdk → @mitii/v8
 *
 * This package owns host-side adapters and orchestration that must not live in
 * V8 or the SDK: SQLite injection, workspace indexing, durable FS stores,
 * optional SearchPort, disk skills, project rules, and provider presets.
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
  EmbeddingPreset,
  EmbeddingPresetId,
  EmbeddingProbeResult,
  SemanticIndexSettings,
  SemanticIndexEnablementOptions,
  IndexRuntimeMetadata,
} from './indexing/semanticIndex.js';

export {
  runFullWorkspaceIndex,
} from './indexing/fullWorkspaceIndex.js';
export type { FullWorkspaceIndexResult } from './indexing/fullWorkspaceIndex.js';

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
export { buildWorkspaceSnapshot } from './indexing/fingerprintSnapshot.js';
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

export {
  createWorkspaceMemoryStore,
  FileWorkspaceMemoryStore,
} from './ports/memoryStore.js';

export {
  createOptionalSearchPort,
  BraveSearchAdapter,
} from './ports/search.js';

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
