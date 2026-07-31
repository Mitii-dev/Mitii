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
  createLanceDbConnection,
  writeIndexRuntimeMetadata,
  readIndexRuntimeMetadata,
  normalizePositiveInteger,
} from './indexing/semanticIndex.js';
export type {
  SemanticIndexSettings,
  IndexRuntimeMetadata,
} from './indexing/semanticIndex.js';

export {
  runFullWorkspaceIndex,
} from './indexing/fullWorkspaceIndex.js';
export type { FullWorkspaceIndexResult } from './indexing/fullWorkspaceIndex.js';

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
// Config UX — OpenAI-compatible endpoint presets (not a V8 port)
// ---------------------------------------------------------------------------
export {
  PROVIDER_PRESETS,
  getProviderPreset,
  isLocalBaseUrl,
} from './config/providerPresets.js';
export type {
  ProviderPreset,
  ProviderPresetId,
} from './config/providerPresets.js';
