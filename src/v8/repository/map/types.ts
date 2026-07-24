import type { ProjectCatalog } from "../catalog";
import type { WorkspaceSnapshot } from "../workspace";

/**
 * FILES AND SYMBOLS
 */

export type RepoMapSymbolKind =
  | "class"
  | "interface"
  | "struct"
  | "function"
  | "method"
  | "type"
  | "enum"
  | "const"
  | "variable"
  | "module"
  | "namespace"
  | "property"
  | "symbol";

export interface RepoMapFile {
  /**
   * Stable ID within this snapshot/data source.
   */
  id: string;

  rootId: string;
  relativePath: string;

  projectId?: string;
  language?: string;

  size?: number;
  modifiedAt?: string;
  contentHash?: string;
}

export interface RepoMapSymbol {
  id: string;
  fileId: string;

  name: string;
  kind: RepoMapSymbolKind | string;

  exported?: boolean;
  signature?: string;

  startLine?: number;
  endLine?: number;
}

export interface RepoMapImport {
  fromFileId: string;

  /**
   * Present when the import resolves to a file
   * inside the current snapshot.
   */
  toFileId?: string;

  /**
   * Original import specifier.
   */
  specifier: string;

  importedNames: string[];
}

export interface RepoMapReference {
  fromFileId: string;
  symbolName: string;

  toSymbolId?: string;
  toFileId?: string;
}

/**
 * FILE SELECTION
 */

export interface RepoMapFileLocator {
  /**
   * Optional for backward-compatible path-only callers.
   *
   * Supplying rootId is recommended in multi-root workspaces.
   */
  rootId?: string;

  relativePath: string;
}

export type RepoMapFileSelection = string | RepoMapFileLocator;

/**
 * RANKING CONTEXT
 */

export interface RepoMapRankingContext {
  query?: string;

  /**
   * Restricts the complete map to selected workspace roots.
   */
  rootIds?: readonly string[];

  folderPrefix?: string;

  currentFile?: RepoMapFileSelection;

  openFiles?: readonly RepoMapFileSelection[];
  gitDiffFiles?: readonly RepoMapFileSelection[];
  diagnosticFiles?: readonly RepoMapFileSelection[];
  recentEditFiles?: readonly RepoMapFileSelection[];
}

export type RepoMapScoreReasonType =
  | "current_file"
  | "open_file"
  | "git_diff"
  | "diagnostic"
  | "recent_edit"
  | "query_path"
  | "query_symbol"
  | "reference_count"
  | "import_count"
  | "page_rank"
  | "entry_point";

export interface RepoMapScoreReason {
  type: RepoMapScoreReasonType;
  score: number;
  evidence: string;
}

export interface RepoMapEntry {
  file: RepoMapFile;
  symbols: RepoMapSymbol[];

  score: number;
  pageRank: number;

  inboundImportCount: number;
  outboundImportCount: number;

  /**
   * Number of references originating from this file.
   */
  referenceCount: number;

  reasons: RepoMapScoreReason[];
}

/**
 * BUDGET
 */

export interface RepoMapBudget {
  maximumEntries?: number;
  maximumSymbolsPerEntry?: number;
  maximumEstimatedTokens?: number;

  /**
   * Retain at least this many entries when available,
   * even when their estimated size exceeds the token budget.
   */
  minimumEntries?: number;
}

export interface RepoMapBudgetResult {
  entries: RepoMapEntry[];

  estimatedTokens: number;
  truncated: boolean;
}

/**
 * BUILD INPUT AND OUTPUT
 */

export interface RepoMapBuildInput {
  snapshot: WorkspaceSnapshot;
  catalog: ProjectCatalog;

  ranking?: RepoMapRankingContext;
  budget?: RepoMapBudget;

  abortSignal?: AbortSignal;
}

export type RepoMapStatus = "complete" | "partial" | "cancelled";

export interface RepoMapStatistics {
  /**
   * Number of files available before maximumFiles
   * and output-budget restrictions.
   */
  availableFiles: number;

  /**
   * Number of files actually ranked.
   */
  rankedFiles: number;

  /**
   * Number of files included after applying output budget.
   */
  includedFiles: number;

  includedSymbols: number;
  estimatedTokens: number;
  durationMs: number;
}

export interface RepoMap {
  schemaVersion: 1;

  workspaceSnapshotId: string;

  entries: RepoMapEntry[];

  statistics: RepoMapStatistics;
  status: RepoMapStatus;

  generatedAt: string;
}

/**
 * DATA SOURCE
 */

export interface RepoMapDataSourceContext {
  snapshot: WorkspaceSnapshot;
  abortSignal?: AbortSignal;
}

export interface RepoMapFileQuery {
  rootIds?: readonly string[];
  folderPrefix?: string;

  /**
   * Hard safety bound.
   */
  maximumFiles: number;
}

export interface RepoMapFileQueryResult {
  files: readonly RepoMapFile[];

  /**
   * Number of matching files before maximumFiles was applied.
   */
  totalAvailable: number;

  truncated: boolean;
}

export interface RepoMapDataSource {
  readonly id: string;

  /**
   * Must be inexpensive, deterministic and side-effect-free.
   */
  getChangeToken(context: RepoMapDataSourceContext): Promise<string>;

  /**
   * Returned files must be members of context.snapshot.
   */
  getFiles(
    query: RepoMapFileQuery,
    context: RepoMapDataSourceContext,
  ): Promise<RepoMapFileQueryResult>;

  /**
   * The returned map must contain every requested file ID.
   *
   * Files without symbols must map to an empty array.
   * Unrequested file IDs must not be returned.
   */
  getSymbols(
    fileIds: readonly string[],
    context: RepoMapDataSourceContext,
  ): Promise<ReadonlyMap<string, readonly RepoMapSymbol[]>>;

  /**
   * Returns imports originating from requested files.
   */
  getImports(
    fromFileIds: readonly string[],
    context: RepoMapDataSourceContext,
  ): Promise<readonly RepoMapImport[]>;

  /**
   * Returns references originating from requested files.
   */
  getReferences(
    fromFileIds: readonly string[],
    context: RepoMapDataSourceContext,
  ): Promise<readonly RepoMapReference[]>;
}

/**
 * DATA-SOURCE ERRORS
 */

export type RepoMapDataSourceOperation =
  | "get_change_token"
  | "get_files"
  | "get_symbols"
  | "get_imports"
  | "get_references";

export interface RepoMapDataSourceErrorOptions {
  operation: RepoMapDataSourceOperation;
  dataSourceId: string;
  cause?: unknown;
}

/**
 * RANKING
 */

export interface RepoMapRankerOptions {
  maximumFiles?: number;

  symbolBatchSize?: number;
  graphBatchSize?: number;

  maximumSymbolsPerFile?: number;

  pageRankIterations?: number;
  pageRankDamping?: number;
}

export interface RepoMapRankingInput {
  snapshot: WorkspaceSnapshot;
  catalog: ProjectCatalog;

  context: RepoMapRankingContext;

  abortSignal?: AbortSignal;
}

export interface RepoMapRankingResult {
  files: RepoMapFile[];
  entries: RepoMapEntry[];

  totalAvailableFiles: number;
  complete: boolean;
}

/**
 * PAGE RANK
 */

export interface PageRankEdge {
  from: string;
  to: string;
  weight?: number;
}

export interface PageRankOptions {
  damping?: number;
  iterations?: number;
  personalization?: ReadonlyMap<string, number>;
}

/**
 * RENDERING
 */

export interface RepoMapRendererOptions {
  includeScores?: boolean;
  includeEmptyFiles?: boolean;
  includeStatistics?: boolean;
}
