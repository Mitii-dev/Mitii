import type {
  ChunkKind,
} from "../chunking/types";

import type {
  EmbeddingIndexState,
  EmbeddingIndexWritePort,
  EmbeddingProfile,
} from "../embedding/types";

/**
 * VECTOR SEARCH
 */

export interface VectorSearchInput {
  workspace: string;
  profile: EmbeddingProfile;
  queryVector: readonly number[];

  rootIds?: readonly string[];
  folderPrefix?: string;
  filePaths?: readonly string[];
  kinds?: readonly ChunkKind[];

  maximumResults?: number;
  minimumScore?: number;
  candidateMultiplier?: number;

  nprobes?: number;
  refineFactor?: number;

  abortSignal?: AbortSignal;
}

export interface NormalizedVectorSearchRequest {
  workspace: string;
  profile: EmbeddingProfile;
  queryVector: number[];

  rootIds: string[];
  folderPrefix?: string;
  filePaths: string[];
  kinds: ChunkKind[];

  maximumResults: number;
  minimumScore: number;
  candidateLimit: number;

  nprobes: number;
  refineFactor: number;
}

export interface VectorSearchMatch {
  chunkId: string;

  rootId: string;
  relativePath: string;

  kind: ChunkKind;
  ordinal: number;

  contentHash: string;
  tokenEstimate: number;

  startLine: number;
  endLine: number;

  title?: string;
  symbolLocalId?: string;

  profileId: string;

  /**
   * Normalized cosine similarity in the range [0, 1].
   */
  score: number;

  /**
   * Raw cosine distance returned by the vector store.
   */
  distance: number;
}

export type VectorSearchStatus =
  | "complete"
  | "empty"
  | "cancelled";

export interface VectorSearchResult {
  schemaVersion: 1;

  status: VectorSearchStatus;
  profile: EmbeddingProfile;

  matches: VectorSearchMatch[];
  truncated: boolean;
}

export interface VectorIndexSearchPage {
  matches: VectorSearchMatch[];
  truncated: boolean;
}

export interface VectorIndexReadContext {
  abortSignal?: AbortSignal;
}

export interface VectorIndexReadPort {
  readonly id: string;

  search(
    request: NormalizedVectorSearchRequest,
    context?: VectorIndexReadContext,
  ): Promise<VectorIndexSearchPage>;
}

/**
 * MODULE COMPOSITION
 */

export interface VectorIndexModule {
  reader: VectorIndexReadPort;
  writer: EmbeddingIndexWritePort;

  search(input: VectorSearchInput): Promise<VectorSearchResult>;
}

export interface VectorIndexFactoryDependencies {
  reader: VectorIndexReadPort;
  writer: EmbeddingIndexWritePort;
}

/**
 * LANCEDB STRUCTURAL PORTS
 *
 * These interfaces intentionally describe only the LanceDB operations
 * used by this module. The engine may pass a real @lancedb/lancedb
 * Connection without making the V8 library create or own it.
 */

export type LanceDbRow =
  Record<string, unknown>;

export interface LanceDbConnectionPort {
  tableNames(): Promise<string[]>;

  openTable(
    name: string,
  ): Promise<LanceDbTablePort>;

  createTable(
    name: string,
    data: LanceDbRow[],
    options?: LanceDbCreateTableOptions,
  ): Promise<LanceDbTablePort>;
}

export interface LanceDbCreateTableOptions {
  mode?:
    | "create"
    | "overwrite";
  existOk?: boolean;
}

export interface LanceDbQueryPort {
  where(predicate: string): this;
  select(columns: string[]): this;
  limit(limit: number): this;
  toArray(): Promise<unknown[]>;
}

export interface LanceDbVectorQueryPort
  extends LanceDbQueryPort {
  column(column: string): this;
  distanceType(
    distanceType: "cosine",
  ): this;
  nprobes(value: number): this;
  refineFactor(value: number): this;
}

export interface LanceDbMergeInsertResult {
  version: number;
  numInsertedRows: number;
  numUpdatedRows: number;
  numDeletedRows: number;
  numAttempts: number;
  numRows: number;
}

export interface LanceDbMergeInsertPort {
  whenMatchedUpdateAll(): this;

  whenNotMatchedInsertAll(): this;

  execute(
    data: LanceDbRow[],
  ): Promise<LanceDbMergeInsertResult>;
}

export interface LanceDbTablePort {
  query(): LanceDbQueryPort;

  vectorSearch(
    vector: number[],
  ): LanceDbVectorQueryPort;

  mergeInsert(
    on: string | readonly string[],
  ): LanceDbMergeInsertPort;
}

/**
 * LANCEDB ROWS
 */

export type LanceDbVectorRowType =
  | "state"
  | "vector";

export interface LanceDbVectorRowBase {
  workspace: string;
  root_id: string;

  profile_id: string;
  provider_id: string;
  model_id: string;
  dimensions: number;
  normalized: boolean;

  chunk_id: string;
  relative_path: string;
  kind: ChunkKind | "state";
  ordinal: number;

  content_hash: string;
  token_estimate: number;

  start_line: number;
  end_line: number;

  title: string;
  symbol_local_id: string;

  active: boolean;
  text_revision: number;
  updated_at: number;

  vector: number[];
}

export interface LanceDbVectorRow
  extends LanceDbVectorRowBase
{
  [key: string]: unknown;

  record_key: string;
  row_type: LanceDbVectorRowType;
}

export interface LanceDbVectorIndexAdapterOptions {
  tableNamePrefix?: string;
}

export interface ResolvedLanceDbVectorIndexAdapterOptions {
  tableNamePrefix: string;
}

export interface LanceDbVectorIndexComponents {
  reader: VectorIndexReadPort;
  writer: EmbeddingIndexWritePort;
}

/**
 * ERRORS
 */

export type VectorIndexOperation =
  | "normalize_search"
  | "search"
  | "open_table"
  | "read_state"
  | "write_batch"
  | "map_row";

export interface VectorIndexErrorOptions {
  operation: VectorIndexOperation;
  componentId: string;
  cause?: unknown;
}

export interface VectorIndexRevisionMismatchDetails {
  expectedTextRevision: number;
  actualTextRevision: number;
}

export interface VectorIndexProfileMismatchDetails {
  expectedProfileId: string;
  actualProfileId: string;
}

export interface VectorIndexStateReader {
  getState(
    locator: {
      workspace: string;
      rootId: string;
      profileId: string;
    },
    context?: {
      abortSignal?: AbortSignal;
    },
  ): Promise<EmbeddingIndexState | null>;
}
