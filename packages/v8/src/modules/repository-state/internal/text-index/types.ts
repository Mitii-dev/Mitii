import type {
  Chunk,
  ChunkingResult,
} from "../chunking/types";

import type {
  TEXT_INDEX_SCHEMA_VERSION,
} from "./constants";

import type {
  SqliteDatabasePort,
  SqliteReadDatabasePort,
} from "../shared/sqlite";

/**
 * DOCUMENTS
 */

export interface TextIndexDocumentLocator {
  workspace: string;
  rootId: string;
  relativePath: string;
}

export type TextIndexDocumentStatus =
  | "complete"
  | "partial"
  | "empty";

export interface TextIndexDocument {
  schemaVersion: typeof TEXT_INDEX_SCHEMA_VERSION;

  workspace: string;
  rootId: string;
  relativePath: string;
  sourceId: string;

  sourceContentHash: string;
  language?: string;

  chunkingSchemaVersion: 1;
  pipelineVersion: string;
  chunkingStatus: TextIndexDocumentStatus;
  strategyId?: string;

  chunks: Chunk[];

  workspaceSnapshotId: string;
  indexedAt: number;
}

export interface TextIndexDocumentState
  extends TextIndexDocumentLocator {
  sourceId: string;
  sourceContentHash: string;
  pipelineVersion: string;
  chunkingStatus: TextIndexDocumentStatus;
  chunkCount: number;
  workspaceSnapshotId: string;
  indexedAt: number;
}

export interface TextIndexDocumentMapperInput {
  workspace: string;
  workspaceSnapshotId: string;
  indexedAt: number;
  pipelineVersion?: string;
  chunking: ChunkingResult;
}

/**
 * SEARCH
 */

export type TextSearchMode =
  | "any"
  | "all"
  | "phrase";

export interface TextSearchInput {
  workspace: string;
  query: string;

  mode?: TextSearchMode;
  prefixMatching?: boolean;
  maximumResults?: number;
  snippetTokenCount?: number;

  rootIds?: readonly string[];
  folderPrefix?: string;
  filePaths?: readonly string[];
  kinds?: readonly Chunk["kind"][];

  abortSignal?: AbortSignal;
}

export interface NormalizedTextSearchRequest {
  workspace: string;
  originalQuery: string;
  terms: string[];

  mode: TextSearchMode;
  prefixMatching: boolean;
  maximumResults: number;
  snippetTokenCount: number;

  rootIds: string[];
  folderPrefix?: string;
  filePaths: string[];
  kinds: Chunk["kind"][];
}

export interface TextSearchMatch {
  chunkId: string;

  rootId: string;
  relativePath: string;

  ordinal: number;
  kind: Chunk["kind"];

  title?: string;
  symbolLocalId?: string;

  snippet: string;
  score: number;
  rawRank: number;

  startLine: number;
  endLine: number;

  contentHash: string;
  tokenEstimate: number;
}

export type TextSearchStatus =
  | "complete"
  | "empty"
  | "cancelled";

export type TextSearchWarningCode =
  | "query_truncated"
  | "terms_truncated"
  | "terms_removed"
  | "duplicate_filter_removed";

export interface TextSearchWarning {
  code: TextSearchWarningCode;
  message: string;
}

export interface TextSearchResult {
  schemaVersion: typeof TEXT_INDEX_SCHEMA_VERSION;

  query: string;
  normalizedTerms: string[];
  status: TextSearchStatus;

  matches: TextSearchMatch[];
  truncated: boolean;
  warnings: TextSearchWarning[];
}

export interface TextSearchNormalization {
  request?: NormalizedTextSearchRequest;
  warnings: TextSearchWarning[];
}

export interface TextIndexSearchPage {
  matches: TextSearchMatch[];
  truncated: boolean;
}

export interface TextIndexReadContext {
  abortSignal?: AbortSignal;
}

/**
 * CHANGE FEED
 */

export type TextIndexChangeKind =
  | "upsert"
  | "delete";

export interface TextIndexChange {
  revision: number;
  kind: TextIndexChangeKind;
  chunkId: string;
  rootId: string;
  relativePath: string;
  changedAt: number;
}

export interface TextIndexChangeQuery {
  workspace: string;
  rootId: string;
  afterRevision: number;
  maximumChanges: number;
}

export interface TextIndexChangeQueryResult {
  changes: TextIndexChange[];
  latestRevision: number;
  truncated: boolean;
}

export interface TextIndexChunkQuery {
  workspace: string;
  chunkIds: readonly string[];
  maximumChunks: number;
}

export interface TextIndexChunkQueryResult {
  chunks: Chunk[];
  missingChunkIds: string[];
  truncated: boolean;
}

/**
 * READ AND WRITE PORTS
 */

export interface TextIndexReadPort {
  readonly id: string;

  search(
    request: NormalizedTextSearchRequest,
    context?: TextIndexReadContext,
  ): Promise<TextIndexSearchPage>;

  getChunks(
    query: TextIndexChunkQuery,
    context?: TextIndexReadContext,
  ): Promise<TextIndexChunkQueryResult>;

  getChanges(
    query: TextIndexChangeQuery,
    context?: TextIndexReadContext,
  ): Promise<TextIndexChangeQueryResult>;

  getRevision(
    workspace: string,
    rootId: string,
    context?: TextIndexReadContext,
  ): Promise<number>;
}

export interface TextIndexWriteContext {
  abortSignal?: AbortSignal;
}

export type TextIndexWriteAction =
  | "inserted"
  | "replaced"
  | "metadata_refreshed"
  | "removed"
  | "not_found";

export interface TextIndexWriteResult {
  action: TextIndexWriteAction;
  document: TextIndexDocumentLocator;
  revision: number;
  chunksWritten: number;
  chunksRemoved: number;
}

export interface TextIndexRemoveMissingInput {
  workspace: string;
  rootId: string;
  retainedRelativePaths: readonly string[];
  workspaceSnapshotId: string;
  changedAt: number;
}

export interface TextIndexRemoveMissingResult {
  removedRelativePaths: string[];
  removedChunks: number;
  revision: number;
}

export interface TextIndexWritePort {
  readonly id: string;

  getDocumentState(
    locator: TextIndexDocumentLocator,
    context?: TextIndexWriteContext,
  ): Promise<TextIndexDocumentState | null>;

  replaceDocument(
    document: TextIndexDocument,
    context?: TextIndexWriteContext,
  ): Promise<TextIndexWriteResult>;

  refreshDocumentMetadata(
    document: TextIndexDocument,
    context?: TextIndexWriteContext,
  ): Promise<TextIndexWriteResult>;

  removeDocument(
    locator: TextIndexDocumentLocator,
    workspaceSnapshotId: string,
    changedAt: number,
    context?: TextIndexWriteContext,
  ): Promise<TextIndexWriteResult>;

  removeMissingDocuments(
    input: TextIndexRemoveMissingInput,
    context?: TextIndexWriteContext,
  ): Promise<TextIndexRemoveMissingResult>;
}

/**
 * UPDATE PLANNING
 */

export type TextIndexUpdateAction =
  | "insert"
  | "replace"
  | "refresh_metadata"
  | "skip"
  | "remove";

export type TextIndexUpdateReason =
  | "document_not_indexed"
  | "source_changed"
  | "pipeline_changed"
  | "chunking_status_changed"
  | "chunk_count_changed"
  | "snapshot_changed"
  | "unchanged"
  | "document_removed";

export interface TextIndexUpdatePlan {
  action: TextIndexUpdateAction;
  reason: TextIndexUpdateReason;
}

export interface TextIndexUpdatePlannerInput {
  desired?: TextIndexDocument;
  current: TextIndexDocumentState | null;
  removed?: boolean;
}

export type TextIndexUpdateStatus =
  | "indexed"
  | "metadata_refreshed"
  | "unchanged"
  | "removed"
  | "not_found";

export interface TextIndexUpdateResult {
  status: TextIndexUpdateStatus;
  plan: TextIndexUpdatePlan;
  write?: TextIndexWriteResult;
}

export interface TextIndexUpdaterInput {
  document: TextIndexDocument;
  abortSignal?: AbortSignal;
}

export interface TextIndexRemovalInput {
  locator: TextIndexDocumentLocator;
  workspaceSnapshotId: string;
  changedAt: number;
  abortSignal?: AbortSignal;
}

/**
 * COORDINATION
 */

export type TextIndexCoordinatorStatus =
  | "indexed"
  | "metadata_refreshed"
  | "unchanged"
  | "empty_indexed"
  | "cancelled"
  | "not_indexable";

export interface TextIndexCoordinatorInput
  extends TextIndexDocumentMapperInput {
  abortSignal?: AbortSignal;
}

export interface TextIndexCoordinatorResult {
  schemaVersion: typeof TEXT_INDEX_SCHEMA_VERSION;
  status: TextIndexCoordinatorStatus;
  chunkingStatus: ChunkingResult["status"];
  update?: TextIndexUpdateResult;
}

/**
 * SQLITE ADAPTER
 */

export type TextIndexSqliteDatabasePort =
  SqliteDatabasePort;

export type TextIndexSqliteReadDatabasePort =
  SqliteReadDatabasePort;

export interface SqliteTextIndexAdapterOptions {
  adapterId?: string;
}

export interface SqliteTextIndexQuery {
  sql: string;
  parameters: unknown[];
}

export interface SqliteTextIndexDocumentStateRow {
  workspace: string;
  rootId: string;
  relativePath: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineVersion: string;
  chunkingStatus: TextIndexDocumentStatus;
  chunkCount: number;
  workspaceSnapshotId: string;
  indexedAt: number;
}

export interface SqliteTextIndexChunkRow {
  id: string;
  sourceId: string;
  rootId: string;
  relativePath: string;
  strategyId: string;
  ordinal: number;
  kind: Chunk["kind"];
  content: string;
  sourceContentHash: string;
  contentHash: string;
  tokenEstimate: number;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  title: string | null;
  symbolLocalId: string | null;
}

export interface SqliteTextSearchRow {
  chunkId: string;
  rootId: string;
  relativePath: string;
  ordinal: number;
  kind: Chunk["kind"];
  title: string | null;
  symbolLocalId: string | null;
  snippet: string;
  rawRank: number;
  startLine: number;
  endLine: number;
  contentHash: string;
  tokenEstimate: number;
}

export interface SqliteTextIndexChangeRow {
  revision: number;
  kind: TextIndexChangeKind;
  chunkId: string;
  rootId: string;
  relativePath: string;
  changedAt: number;
}

export interface SqliteTextIndexRevisionRow {
  revision: number;
}

export interface SqliteTextIndexChunkIdRow {
  id: string;
  relativePath: string;
}

export interface TextIndexMigrationResult {
  schemaVersion: typeof TEXT_INDEX_SCHEMA_VERSION;
}

export interface SqliteTextIndexModule {
  reader: TextIndexReadPort;
  writer: TextIndexWritePort;

  search: {
    search(
      input: TextSearchInput,
    ): Promise<TextSearchResult>;
  };

  coordinator: {
    index(
      input: TextIndexCoordinatorInput,
    ): Promise<TextIndexCoordinatorResult>;
  };

  updater: {
    update(
      input: TextIndexUpdaterInput,
    ): Promise<TextIndexUpdateResult>;

    remove(
      input: TextIndexRemovalInput,
    ): Promise<TextIndexUpdateResult>;
  };
}

/**
 * ERRORS
 */

export type TextIndexOperation =
  | "migrate"
  | "normalize_query"
  | "search"
  | "get_chunks"
  | "get_changes"
  | "get_revision"
  | "get_document_state"
  | "replace_document"
  | "refresh_metadata"
  | "remove_document"
  | "remove_missing_documents";

export interface TextIndexErrorOptions {
  operation: TextIndexOperation;
  adapterId: string;
  cause?: unknown;
}
