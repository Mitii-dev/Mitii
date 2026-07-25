import type {
  RepoGraph,
} from "../repo-graph";

/**
 * FILES AND SYMBOLS
 */

export interface RepoMapFile {
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
  kind: string;
  parentSymbolId?: string;
  exported?: boolean;
  signature?: string;
  startLine?: number;
  endLine?: number;
}

/**
 * SELECTION AND RANKING CONTEXT
 */

export interface RepoMapFileLocator {
  rootId?: string;
  relativePath: string;
}

export type RepoMapFileSelection =
  | string
  | RepoMapFileLocator;

export interface RepoMapRankingContext {
  query?: string;
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
  | "inbound_import"
  | "outbound_import"
  | "inbound_reference"
  | "outbound_reference"
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
  inboundReferenceCount: number;
  outboundReferenceCount: number;
  reasons: RepoMapScoreReason[];
}

/**
 * BUDGET
 */

export interface RepoMapBudget {
  maximumEntries?: number;
  maximumSymbolsPerEntry?: number;
  maximumEstimatedTokens?: number;
  minimumEntries?: number;
}

export interface RepoMapBudgetResult {
  entries: RepoMapEntry[];
  estimatedTokens: number;
  truncated: boolean;
}

/**
 * RANKING
 */

export interface RepoMapRankerOptions {
  maximumFiles?: number;
  maximumSymbolsPerFile?: number;
  pageRankIterations?: number;
  pageRankDamping?: number;
}

export interface RepoMapRankingInput {
  graph: RepoGraph;
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
 * BUILD INPUT AND OUTPUT
 */

export interface RepoMapBuildInput {
  graph: RepoGraph;
  ranking?: RepoMapRankingContext;
  budget?: RepoMapBudget;
  abortSignal?: AbortSignal;
}

export type RepoMapStatus =
  | "complete"
  | "partial";

export interface RepoMapStatistics {
  availableFiles: number;
  rankedFiles: number;
  includedFiles: number;
  includedSymbols: number;
  estimatedTokens: number;
  durationMs: number;
}

export interface RepoMap {
  schemaVersion: 1;
  workspaceSnapshotId: string;
  codeIndexChangeToken: string;
  entries: RepoMapEntry[];
  statistics: RepoMapStatistics;
  status: RepoMapStatus;
  generatedAt: string;
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
  personalization?: ReadonlyMap<
    string,
    number
  >;
}

/**
 * RENDERING
 */

export interface RepoMapRendererOptions {
  includeScores?: boolean;
  includeEmptyFiles?: boolean;
  includeStatistics?: boolean;
}

