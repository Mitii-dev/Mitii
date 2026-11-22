/** Indexing — turn a workspace into durable `.mitii` artifacts. */

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
} from '../indexing/semanticIndex.js';
export type {
  EmbeddingBackend,
  EmbeddingSource,
  EmbeddingPreset,
  EmbeddingPresetId,
  EmbeddingProbeResult,
  SemanticIndexSettings,
  SemanticIndexEnablementOptions,
  IndexRuntimeMetadata,
} from '../indexing/semanticIndex.js';
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
} from '../indexing/bundled-embedding/index.js';
export type {
  EmbeddingSourceResolution,
  EmbeddingSourceResolutionInput,
} from '../indexing/bundled-embedding/index.js';

export { runFullWorkspaceIndex, estimateIndexProgressPercent } from '../indexing/fullWorkspaceIndex.js';
export type {
  FullWorkspaceIndexResult,
  WorkspaceIndexProgress,
  WorkspaceIndexProgressStage,
} from '../indexing/fullWorkspaceIndex.js';

export {
  IndexLockedError,
  acquireIndexLock,
  isIndexLockHeld,
  readIndexLockInfo,
  readIndexProgress,
  writeIndexProgress,
  clearIndexProgress,
  INDEX_LOCK_FILE,
  INDEX_LOCK_STALE_MS,
  INDEX_PROGRESS_FILE,
} from '../indexing/indexLock.js';
export type { IndexLockInfo, IndexProgressSnapshot } from '../indexing/indexLock.js';

export {
  INDEX_PIPELINE_HEALTH_SCHEMA_VERSION,
  readIndexPipelineHealth,
  formatIndexPipelineHealthLines,
} from '../indexing/indexPipelineHealth.js';
export type {
  IndexOverallHealth,
  IndexPipelineEntry,
  IndexPipelineHealth,
  IndexPipelineStatus,
  IndexNativeHealth,
  ReadIndexPipelineHealthOptions,
} from '../indexing/indexPipelineHealth.js';

export {
  DEFAULT_MAXIMUM_INDEX_FILES,
  MAXIMUM_INDEX_FILES,
  DEFAULT_INDEX_SCAN_TIMEOUT_MS,
  MAXIMUM_INDEX_SCAN_TIMEOUT_MS,
  DEFAULT_INDEX_CONCURRENCY,
  MINIMUM_INDEX_CONCURRENCY,
  MAXIMUM_INDEX_CONCURRENCY,
  RECOMMENDED_INDEX_CONCURRENCY_MIN,
  RECOMMENDED_INDEX_CONCURRENCY_MAX,
  resolveMaximumIndexFiles,
  resolveIndexScanTimeoutMs,
  resolveIndexConcurrency,
} from '../indexing/indexLimits.js';
export { isSecurityConcern, WorkspaceIgnorePolicy, WS_CONSTANTS } from '@mitii/v8';

export {
  WEB_TREE_SITTER_GRAMMAR_WASM_BY_LANGUAGE,
  WebTreeSitterRuntime,
  resolveTreeSitterPackageAsset,
} from '../indexing/treeSitter/WebTreeSitterRuntime.js';
export type { WebTreeSitterRuntimeOptions } from '../indexing/treeSitter/WebTreeSitterRuntime.js';
export { createDefaultTreeSitterRuntime } from '../indexing/treeSitter/createDefaultTreeSitterRuntime.js';

/**
 * Fingerprint-only publish candidate (honest: indexes unavailable).
 * Not the V8 `WorkspaceSnapshot` artifact used by indexing/retrieval.
 */
export {
  buildWorkspaceSnapshot,
  resolveFingerprintRootId,
  enrichFingerprintWithPersistedVectorProfile,
} from '../indexing/fingerprintSnapshot.js';
export type {
  WorkspaceSnapshot,
  WorkspaceSnapshotOptions,
} from '../indexing/fingerprintSnapshot.js';
