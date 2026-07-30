export type {
  HostSqliteDatabase,
  HostSqliteOpenOptions,
  OpenHostSqliteDatabase,
} from './sqlite.js';

export {
  OpenAiCompatibleEmbeddingProvider,
  createLanceDbConnection,
  writeIndexRuntimeMetadata,
  readIndexRuntimeMetadata,
  normalizePositiveInteger,
} from './semanticIndex.js';
export type {
  SemanticIndexSettings,
  IndexRuntimeMetadata,
} from './semanticIndex.js';

export {
  runFullWorkspaceIndex,
} from './fullWorkspaceIndex.js';
export type { FullWorkspaceIndexResult } from './fullWorkspaceIndex.js';

export { createHostRepositoryContext } from './repositoryContextHost.js';

export { createWorkspaceCheckpointStore } from './checkpoints.js';

export {
  PROVIDER_PRESETS,
  getProviderPreset,
  isLocalBaseUrl,
} from './providerPresets.js';
export type {
  ProviderPreset,
  ProviderPresetId,
} from './providerPresets.js';
