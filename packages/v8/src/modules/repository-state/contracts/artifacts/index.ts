/**
 * Cross-module artifact contracts owned by Repository State.
 * Implementation remains under internal/; this barrel is the public contract surface.
 */

export type {
  WorkspaceSnapshot,
  WorkspaceFileEntry,
} from "../../helpers/workspace/types";
export {
  workspaceSnapshotSchema,
  workspaceEntrySchema,
} from "../../helpers/workspace/schema";

export type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
  RepoGraphEdge,
  RepoGraphEdgeType,
} from "../../helpers/repo-graph/types";
export { repoGraphSchema } from "../../helpers/repo-graph/schema";

export type { RepoMap, RepoMapEntry, RepoMapRankingContext } from "../../helpers/repo-map/types";
export { repoMapSchema } from "../../helpers/repo-map/schema";
export { RepoMapRanker } from "../../helpers/repo-map/ranking/RepoMapRanker";

export type {
  Chunk,
  ChunkKind,
  ChunkTokenEstimator,
} from "../../helpers/chunking/types";

export type {
  TextSearchMatch,
  TextIndexReadPort,
} from "../../helpers/text-index/types";

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
} from "../../helpers/vector-index/types";

export type {
  EmbeddingProfile,
  EmbeddingProvider,
} from "../../helpers/embedding/types";

export type {
  FileSystemReadPort,
  FileSystemPort,
} from "../../helpers/shared/filesystem/types";

export type {
  SqliteCodeIndexDatabasePort,
} from "../../helpers/code-indexing/types";

export type {
  SqliteTextIndexModule,
  TextIndexSqliteDatabasePort,
} from "../../helpers/text-index/types";
