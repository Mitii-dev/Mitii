/**
 * Cross-module artifact contracts owned by Repository State.
 * Implementation remains under internal/; this barrel is the public contract surface.
 */

export type {
  WorkspaceSnapshot,
  WorkspaceFileEntry,
} from "../../internal/workspace/types";
export {
  workspaceSnapshotSchema,
  workspaceEntrySchema,
} from "../../internal/workspace/schema";

export type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
  RepoGraphEdge,
} from "../../internal/repo-graph/types";
export { repoGraphSchema } from "../../internal/repo-graph/schema";

export type { RepoMap, RepoMapEntry } from "../../internal/repo-map/types";
export { repoMapSchema } from "../../internal/repo-map/schema";

export type {
  Chunk,
  ChunkKind,
  ChunkTokenEstimator,
} from "../../internal/chunking/types";

export type {
  TextSearchMatch,
  TextIndexReadPort,
} from "../../internal/text-index/types";

export type {
  VectorSearchMatch,
  VectorIndexReadPort,
  LanceDbConnectionPort,
  LanceDbCreateTableOptions,
  LanceDbMergeInsertPort,
  LanceDbMergeInsertResult,
  LanceDbQueryPort,
  LanceDbRow,
  LanceDbTablePort,
  LanceDbVectorQueryPort,
} from "../../internal/vector-index/types";

export type {
  EmbeddingProfile,
  EmbeddingProvider,
} from "../../internal/embedding/types";

export type {
  FileSystemReadPort,
  FileSystemPort,
} from "../../internal/shared/filesystem/types";

export type {
  SqliteCodeIndexDatabasePort,
} from "../../internal/code-indexing/types";

export type {
  SqliteTextIndexModule,
  TextIndexSqliteDatabasePort,
} from "../../internal/text-index/types";
