/** Port adapters — satisfy V8/SDK injection points with filesystem or vendor code. */

export { createWorkspaceCheckpointStore } from '../ports/checkpoints.js';
export { createWorkspaceVerificationStore } from '../ports/verificationRecords.js';
export {
  createTreeSitterVerificationSyntaxPort,
  createOptionalVerificationSyntaxPort,
} from '../ports/verificationSyntax.js';
export { createWorkspaceReviewStore } from '../ports/reviewRecords.js';

export {
  createWorkspaceMemoryStore,
  FileWorkspaceMemoryStore,
} from '../ports/memoryStore.js';
export type { MemoryDeleteResult } from '../ports/memoryStore.js';
export {
  MemoryStorageError,
  memoryStorageErrorCodeSchema,
} from '../ports/memoryStoreErrors.js';
export type { MemoryStorageErrorCode } from '../ports/memoryStoreErrors.js';

export {
  listWorkspaceMemoriesForView,
  commitWorkspaceMemory,
  deleteWorkspaceMemory,
  clearWorkspaceMemories,
  workspaceMemoryScope,
  memoryFactToView,
} from '../ports/workspaceMemoryUi.js';
export type { MemoryItemView } from '../ports/workspaceMemoryUi.js';
export {
  createWorkspaceKnowledgeGraph,
  FileWorkspaceKnowledgeGraphStore,
} from '../ports/knowledgeGraphStore.js';
export { observeWorkspaceEvent } from '../ports/memoryCapture.js';
export type {
  ObserveWorkspaceEventInput,
  ObserveWorkspaceEventResult,
} from '../ports/memoryCapture.js';
export {
  listPendingMemories,
  approvePendingMemory,
  rejectPendingMemory,
  appendPendingMemory,
} from '../ports/memoryPending.js';
export type { PendingMemoryDraft } from '../ports/memoryPending.js';
export {
  observeRunToolEvent,
  shouldObserveRunEvent,
} from '../ports/observeRunEvent.js';
export type {
  MemoryCaptureContext,
  ObservingRunEvent,
} from '../ports/observeRunEvent.js';
export { resolveMemoryEmbeddingPort } from '../ports/resolveMemoryEmbedding.js';
export {
  FileWorkspaceObservationStore,
  evictOldestObservations,
  MAX_OBSERVATIONS_PER_WORKSPACE,
} from '../ports/memoryObservations.js';
export type { MemoryObservation } from '../ports/memoryObservations.js';
export {
  createWorkspaceMemoryLeaseStore,
  FileWorkspaceMemoryLeaseStore,
  MEMORY_LEASE_RESOURCES,
} from '../ports/memoryLeases.js';
export type {
  MemoryLease,
  MemoryLeaseResource,
  LeaseAcquireResult,
  LeaseReleaseResult,
} from '../ports/memoryLeases.js';
export { appendMemoryAudit } from '../ports/memoryAudit.js';
export type { MemoryAuditEvent } from '../ports/memoryAudit.js';
export { createMemoryEmbeddingPort } from '../ports/memoryEmbeddingAdapter.js';

export {
  createOptionalSearchPort,
  BraveSearchAdapter,
  SearchKitSearchAdapter,
  resolveSearchKitConfig,
} from '../ports/search.js';
export type {
  CreateSearchPortOptions,
  SearchKitConfig,
  ResolveSearchKitConfigOptions,
} from '../ports/search.js';
export { RipgrepWorkspaceTextSearchAdapter } from '../ports/RipgrepWorkspaceTextSearchAdapter.js';
export { CompositeWorkspaceTextSearchAdapter } from '../ports/CompositeWorkspaceTextSearchAdapter.js';
export { AstGrepWorkspaceAdapter } from '../ports/AstGrepWorkspaceAdapter.js';
export {
  resolveRipgrepBinary,
  resolveAstGrepBinary,
  resolveScipTypescriptBinary,
  scipIndexPaths,
} from '../ports/resolveHostToolBinaries.js';
export { createHostGitPort } from '../ports/createHostGitPort.js';
export type { CreateHostGitPortOptions } from '../ports/createHostGitPort.js';
export {
  createHostNetworkPort,
  ContentAwareNetworkAdapter,
} from '../ports/network.js';
export type { CreateHostNetworkPortOptions } from '../ports/network.js';

export {
  createFileSystemSkillsCatalog,
  loadDiskSkills,
} from '../ports/skillsCatalog.js';
export type {
  DiskSkillContentMode,
  DiskSkillManifest,
  LoadDiskSkillsOptions,
} from '../ports/skillsCatalog.js';
