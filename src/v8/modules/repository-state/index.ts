export { WorkspaceIndexingPipeline } from "./pipeline/ws-indexing-pipeline/WorkspaceIndexingPipeline";
export { WORKSPACE_INDEXING_PIPELINE_MESSAGES } from "./pipeline/ws-indexing-pipeline/constants";
export { RepositoryStatePipeline } from "./pipeline/RepositoryStatePipeline";
export type {
  RepositoryStatePipelineClock,
  RepositoryStatePipelineDependencies,
} from "./pipeline/RepositoryStatePipeline";
export { InMemoryRepositoryStateStore } from "./adapters/InMemoryRepositoryStateStore";
export {
  buildPublishCandidateFromIndexing,
} from "./actions/buildPublishCandidateFromIndexing";
export type {
  BuildPublishCandidateFromIndexingResult,
  PublishCandidateFromIndexingOptions,
} from "./actions/buildPublishCandidateFromIndexing";

export {
  LANGUAGE_IDS,
  languageIdSchema,
  languageProfileSchema,
  languageDetectionEvidenceSchema,
  projectDescriptorSchema,
  LanguageProfileRegistry,
  defaultLanguageProfileRegistry,
  publishRepositoryStateInputSchema,
  readRepositoryStateInputSchema,
  pinRepositoryStateInputSchema,
  unpinRepositoryStateInputSchema,
  repositoryStateReferenceSchema,
  repositoryCapabilityIdSchema,
  repositoryCapabilityStatusSchema,
  repositoryRootStateSchema,
  repositoryStateReasonSchema,
  repositoryStateReadinessSchema,
  repositoryStateScanCompletenessSchema,
  repositoryStateDescriptorSchema,
  publishRepositoryStateResultSchema,
  readRepositoryStateResultSchema,
  pinRepositoryStateResultSchema,
  unpinRepositoryStateResultSchema,
  repositoryStateErrorCodeSchema,
  RepositoryStateError,
} from "./contracts";
export type {
  LanguageId,
  LanguageProfile,
  LanguageDetectionEvidence,
  ProjectDescriptor,
  LanguageCapabilityLevel,
  PublishRepositoryStateInput,
  ReadRepositoryStateInput,
  PinRepositoryStateInput,
  UnpinRepositoryStateInput,
  RepositoryStateReference,
  RepositoryCapabilityStatus,
  RepositoryRootState,
  RepositoryStateReason,
  RepositoryStateReadiness,
  RepositoryStateScanCompleteness,
  RepositoryStateDescriptor,
  PublishRepositoryStateResult,
  ReadRepositoryStateResult,
  PinRepositoryStateResult,
  UnpinRepositoryStateResult,
  RepositoryStateErrorCode,
  RepositoryStatePublisherPort,
  RepositoryStateReaderPort,
  ActiveRunStateRetentionPort,
  RepositoryStateStorePort,
} from "./contracts";

export {
  REPOSITORY_STATE_SCHEMA_VERSION,
  REPOSITORY_STATE_READINESS,
  REPOSITORY_STATE_SCAN_COMPLETENESS,
  REPOSITORY_CAPABILITY_IDS,
  REPOSITORY_CAPABILITY_STATUSES,
  REPOSITORY_STATE_REASON_CODES,
  REPOSITORY_STATE_ERROR_CODES,
} from "./constants";

// Cross-module contracts consumed by repository-context and application hosts.
export type {
  WorkspaceSnapshot,
  WorkspaceFileEntry,
} from "./internal/workspace/types";
export {
  workspaceSnapshotSchema,
  workspaceEntrySchema,
} from "./internal/workspace/schema";

export type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
  RepoGraphEdge,
} from "./internal/repo-graph/types";
export { repoGraphSchema } from "./internal/repo-graph/schema";

export type { RepoMap, RepoMapEntry } from "./internal/repo-map/types";
export { repoMapSchema } from "./internal/repo-map/schema";

export type {
  Chunk,
  ChunkKind,
  ChunkTokenEstimator,
} from "./internal/chunking/types";
export {
  CharacterTokenEstimator,
} from "./internal/chunking/CharacterTokenEstimator";
export {
  ChunkingFactory,
} from "./internal/chunking/ChunkingFactory";

export type {
  TextSearchMatch,
  TextIndexReadPort,
} from "./internal/text-index/types";
export {
  TextSearchService,
} from "./internal/text-index/TextSearchService";

export type {
  VectorSearchMatch,
  VectorIndexReadPort,
} from "./internal/vector-index/types";
export {
  VectorSearchService,
} from "./internal/vector-index/VectorSearchService";

export type {
  EmbeddingProfile,
  EmbeddingProvider,
} from "./internal/embedding/types";
export {
  EmbeddingVectorValidator,
} from "./internal/embedding/EmbeddingVectorValidator";

export type {
  FileSystemReadPort,
  FileSystemPort,
} from "./internal/shared/filesystem/types";
export {
  InMemoryFileSystemAdapter,
} from "./internal/shared/filesystem/InMemoryFileSystemAdapter";
