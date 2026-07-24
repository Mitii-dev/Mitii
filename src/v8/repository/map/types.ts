import type { ProjectCatalog } from "../catalog";

import type {
  CodeIndexFile,
  CodeIndexImport,
  CodeIndexReference,
  CodeIndexSymbol,
} from "../code-index";

import type { WorkspaceSnapshot } from "../workspace";

/**
 * CODE INDEX COMPATIBILITY
 *
 * Code Index remains the source of truth for factual file,
 * symbol, import, and reference structures.
 */

export type RepoMapSymbol = CodeIndexSymbol;

export type RepoMapImport = CodeIndexImport;

export type RepoMapReference = CodeIndexReference;

/**
 * REPO MAP FILE
 *
 * Repo Map enriches a factual CodeIndexFile with optional
 * project ownership from ProjectCatalog.
 */
export interface RepoMapFile extends CodeIndexFile {
  projectId?: string;
}

/**
 * FILE SELECTION
 */

export interface RepoMapFileLocator {
  /**
   * Optional for backward-compatible, path-only callers.
   *
   * Supplying rootId is recommended for multi-root workspaces.
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
   * Restricts Repo Map generation to selected workspace roots.
   */
  rootIds?: readonly string[];

  /**
   * Canonical workspace-relative folder prefix.
   */
  folderPrefix?: string;

  currentFile?: RepoMapFileSelection;

  openFiles?: readonly RepoMapFileSelection[];

  gitDiffFiles?: readonly RepoMapFileSelection[];

  diagnosticFiles?: readonly RepoMapFileSelection[];

  recentEditFiles?: readonly RepoMapFileSelection[];
}

/**
 * RANKING REASONS
 */

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

/**
 * RANKED REPO MAP ENTRY
 */

export interface RepoMapEntry {
  file: RepoMapFile;

  /**
   * Selected factual symbols from Code Index.
   */
  symbols: CodeIndexSymbol[];

  score: number;
  pageRank: number;

  inboundImportCount: number;
  outboundImportCount: number;

  /**
   * Number of indexed references originating from this file.
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
   * even if their estimated size exceeds the token budget.
   */
  minimumEntries?: number;
}

export interface RepoMapBudgetResult {
  entries: RepoMapEntry[];

  estimatedTokens: number;
  truncated: boolean;
}

/**
 * BUILD INPUT
 */

export interface RepoMapBuildInput {
  snapshot: WorkspaceSnapshot;
  catalog: ProjectCatalog;

  ranking?: RepoMapRankingContext;
  budget?: RepoMapBudget;

  abortSignal?: AbortSignal;
}

/**
 * REPO MAP OUTPUT
 */

export type RepoMapStatus = "complete" | "partial" | "cancelled";

export interface RepoMapStatistics {
  /**
   * Files matching the Code Index query before maximumFiles
   * and output-budget limits.
   */
  availableFiles: number;

  /**
   * Files actually analyzed by RepoMapRanker.
   */
  rankedFiles: number;

  /**
   * Files retained after RepoMapBudgetApplier.
   */
  includedFiles: number;

  includedSymbols: number;

  /**
   * Approximation only. Final model-specific token counting
   * belongs to the context-budgeting layer.
   */
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
 * RANKER OPTIONS
 */

export interface RepoMapRankerOptions {
  /**
   * Maximum files requested from CodeIndexReadPort.
   */
  maximumFiles?: number;

  /**
   * Number of file IDs supplied to getSymbols() per request.
   */
  symbolBatchSize?: number;

  /**
   * Number of file IDs supplied to getImports() and
   * getReferences() per request.
   */
  graphBatchSize?: number;

  /**
   * Number of ranked symbols retained per Repo Map file.
   *
   * This is separate from the larger Code Index retrieval limit.
   */
  maximumSymbolsPerFile?: number;

  pageRankIterations?: number;
  pageRankDamping?: number;

  /**
   * Number of times ranking may retry when the Code Index
   * change token changes during a build.
   */
  maximumConsistencyRetries?: number;
}

/**
 * RANKING INPUT AND RESULT
 */

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

  /**
   * False when maximumFiles, stale-index filtering, or another
   * safe bound prevented a complete ranking.
   */
  complete: boolean;

  /**
   * Number of consistency retries used during this ranking.
   */
  consistencyRetries: number;
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
