import type {
  ChunkKind,
} from "../chunking/types";

import type {
  EmbeddingProvider,
} from "../embedding/types";

import type {
  RepoGraph,
} from "../repo-graph/types";

import type {
  RepoMap,
} from "../repo-map/types";

import type {
  TextIndexReadPort,
} from "../text-index/types";

import type {
  VectorIndexReadPort,
} from "../vector-index/types";

/**
 * REQUEST
 */

export interface HybridRetrievalInput {
  workspace: string;
  query: string;

  rootIds?: readonly string[];
  folderPrefix?: string;
  filePaths?: readonly string[];
  kinds?: readonly ChunkKind[];

  maximumResults?: number;
  maximumCandidatesPerSource?: number;

  /**
   * Optional consistency guards supplied by the caller.
   */
  workspaceSnapshotId?: string;
  codeIndexChangeToken?: string;

  /**
   * Already validated repository intelligence.
   */
  repoMap?: RepoMap;
  repoGraph?: RepoGraph;

  abortSignal?: AbortSignal;
}

export interface NormalizedHybridRetrievalRequest {
  workspace: string;
  query: string;

  rootIds: string[];
  folderPrefix?: string;
  filePaths: string[];
  kinds: ChunkKind[];

  maximumResults: number;
  maximumCandidatesPerSource: number;

  workspaceSnapshotId?: string;
  codeIndexChangeToken?: string;

  repoMap?: RepoMap;
  repoGraph?: RepoGraph;
}

export interface HybridRetrievalNormalization {
  request?: NormalizedHybridRetrievalRequest;
  warnings: HybridRetrievalWarning[];
}

/**
 * SOURCE CONTRACT
 */

export type RetrievalEntityKind =
  | "chunk"
  | "file"
  | "symbol";

export type RetrievalReasonType =
  | "lexical_match"
  | "semantic_match"
  | "repo_map_rank"
  | "graph_path_match"
  | "graph_symbol_match"
  | "graph_import_neighbor"
  | "graph_reference_neighbor"
  | "reranked";

export interface RetrievalReason {
  type: RetrievalReasonType;
  evidence: string;
}

export interface RetrievalCandidate {
  entityKind: RetrievalEntityKind;

  rootId: string;
  relativePath: string;

  chunkId?: string;
  symbolId?: string;

  startLine?: number;
  endLine?: number;

  title?: string;
  preview?: string;

  contentHash?: string;
  tokenEstimate?: number;

  /**
   * Source-local score normalized into [0, 1].
   *
   * Fusion is rank-based, so this score is retained for diagnostics
   * and deterministic source ordering rather than compared across
   * heterogeneous sources.
   */
  sourceScore: number;

  reasons: RetrievalReason[];
}

export type RetrievalSourceStatus =
  | "complete"
  | "empty"
  | "cancelled"
  | "unavailable";

export type RetrievalSourceWarningCode =
  | "source_limit_reached"
  | "query_embedding_truncated"
  | "graph_node_scan_limit_reached"
  | "graph_edge_scan_limit_reached"
  | "upstream_warning";

export interface RetrievalSourceWarning {
  code: RetrievalSourceWarningCode;
  message: string;
}

export interface RetrievalSourceResult {
  status: RetrievalSourceStatus;
  candidates: RetrievalCandidate[];
  truncated: boolean;
  warnings: RetrievalSourceWarning[];
}

export interface RetrievalSourceContext {
  abortSignal?: AbortSignal;
}

export interface RetrievalSource {
  readonly id: string;

  canRetrieve(
    request: NormalizedHybridRetrievalRequest,
  ): boolean;

  retrieve(
    request: NormalizedHybridRetrievalRequest,
    context?: RetrievalSourceContext,
  ): Promise<RetrievalSourceResult>;
}

export interface RetrievalSourceRegistration {
  source: RetrievalSource;
  weight?: number;
  required?: boolean;
}

export interface ResolvedRetrievalSourceRegistration {
  source: RetrievalSource;
  weight: number;
  required: boolean;
}

/**
 * FUSION
 */

export interface RetrievalContribution {
  sourceId: string;
  sourceRank: number;
  sourceScore: number;
  sourceWeight: number;
  reciprocalRankScore: number;
  reasons: RetrievalReason[];
}

export interface HybridRetrievalCandidate {
  key: string;
  entityKind: RetrievalEntityKind;

  rootId: string;
  relativePath: string;

  chunkId?: string;
  symbolId?: string;

  startLine?: number;
  endLine?: number;

  title?: string;
  preview?: string;

  contentHash?: string;
  tokenEstimate?: number;

  fusedScore: number;
  rerankerScore?: number;
  score: number;

  matchedSourceCount: number;
  contributions: RetrievalContribution[];
  reasons: RetrievalReason[];
}

export interface RetrievalFusionInput {
  sourceResults: readonly SuccessfulRetrievalSourceResult[];
  rankConstant: number;
  maximumResults: number;
}

export interface RetrievalFusionResult {
  candidates: HybridRetrievalCandidate[];
  inputCandidates: number;
  uniqueCandidates: number;
  duplicateCandidatesRemoved: number;
  truncated: boolean;
}

export interface MutableRetrievalFusionCandidate {
  key: string;
  candidate: RetrievalCandidate;
  rawFusionScore: number;
  contributions: RetrievalContribution[];
  reasons: RetrievalReason[];
}

export interface SuccessfulRetrievalSourceResult {
  sourceId: string;
  sourceWeight: number;
  candidates: readonly RetrievalCandidate[];
  truncated: boolean;
}

export interface RetrievalSourceExecutionResult {
  registration:
    ResolvedRetrievalSourceRegistration;
  report:
    HybridRetrievalSourceReport;
  result?: RetrievalSourceResult;
  error?: unknown;
}

/**
 * OPTIONAL SECOND-STAGE RERANKING
 */

export interface RetrievalRerankerInput {
  query: string;
  candidates: readonly HybridRetrievalCandidate[];
  maximumResults: number;
  abortSignal?: AbortSignal;
}

export interface RetrievalRerankScore {
  key: string;
  score: number;
  reason?: string;
}

export interface RetrievalRerankerResult {
  scores: RetrievalRerankScore[];
}

export interface RetrievalReranker {
  readonly id: string;

  rerank(
    input: RetrievalRerankerInput,
  ): Promise<RetrievalRerankerResult>;
}

/**
 * OUTPUT
 */

export type HybridRetrievalSourceReportStatus =
  | "complete"
  | "empty"
  | "skipped"
  | "failed"
  | "cancelled";

export interface HybridRetrievalSourceReport {
  sourceId: string;
  status: HybridRetrievalSourceReportStatus;
  required: boolean;
  weight: number;
  candidateCount: number;
  truncated: boolean;
  warningCount: number;
  error?: string;
}

export type HybridRetrievalWarningCode =
  | "query_truncated"
  | "duplicate_filter_removed"
  | "source_failed"
  | "required_source_unavailable"
  | "source_truncated"
  | "result_limit_reached"
  | "failure_policy_unsatisfied"
  | "minimum_sources_unsatisfied"
  | "reranker_failed"
  | "reranker_incomplete";

export interface HybridRetrievalWarning {
  code: HybridRetrievalWarningCode;
  message: string;
  sourceId?: string;
}

export type HybridRetrievalStatus =
  | "complete"
  | "partial"
  | "empty"
  | "cancelled"
  | "failed";

export interface HybridRetrievalStatistics {
  configuredSources: number;
  attemptedSources: number;
  successfulSources: number;
  failedSources: number;
  skippedSources: number;
  sourceCandidates: number;
  uniqueCandidates: number;
  duplicateCandidatesRemoved: number;
  returnedCandidates: number;
}

export interface HybridRetrievalResult {
  schemaVersion: 1;

  query: string;
  status: HybridRetrievalStatus;

  candidates: HybridRetrievalCandidate[];
  sourceReports: HybridRetrievalSourceReport[];
  warnings: HybridRetrievalWarning[];

  truncated: boolean;
  statistics: HybridRetrievalStatistics;
}

/**
 * POLICY AND OPTIONS
 */

export type RetrievalFailureMode =
  | "best_effort"
  | "required_sources"
  | "all_sources";

export type RerankerFailureMode =
  | "fallback_to_fusion"
  | "fail";

export interface HybridRetrieverOptions {
  maximumResults?: number;
  maximumCandidatesPerSource?: number;
  rankConstant?: number;

  failureMode?: RetrievalFailureMode;
  minimumSuccessfulSources?: number;

  rerankerCandidatePool?: number;
  rerankerWeight?: number;
  rerankerFailureMode?: RerankerFailureMode;
}

export interface ResolvedHybridRetrieverOptions {
  maximumResults: number;
  maximumCandidatesPerSource: number;
  rankConstant: number;

  failureMode: RetrievalFailureMode;
  minimumSuccessfulSources: number;

  rerankerCandidatePool: number;
  rerankerWeight: number;
  rerankerFailureMode: RerankerFailureMode;
}

/**
 * FACTORY
 */

export interface HybridRetrievalFactoryDependencies {
  textIndex?: TextIndexReadPort;

  vectorIndex?: VectorIndexReadPort;
  embeddingProvider?: EmbeddingProvider;

  additionalSources?: readonly RetrievalSourceRegistration[];
  reranker?: RetrievalReranker;
}

export interface HybridRetrievalModule {
  retrieve(
    input: HybridRetrievalInput,
  ): Promise<HybridRetrievalResult>;
}

/**
 * SOURCE OPTIONS
 */

export interface RepoGraphRetrievalSourceOptions {
  maximumNodesScanned?: number;
  maximumEdgesScanned?: number;
  maximumAnchorNodes?: number;
  maximumNeighborsPerAnchor?: number;
}

export interface ResolvedRepoGraphRetrievalSourceOptions {
  maximumNodesScanned: number;
  maximumEdgesScanned: number;
  maximumAnchorNodes: number;
  maximumNeighborsPerAnchor: number;
}

/**
 * ERRORS
 */

export type HybridRetrievalOperation =
  | "normalize_request"
  | "register_source"
  | "retrieve"
  | "retrieve_source"
  | "embed_query"
  | "fuse"
  | "rerank";

export interface HybridRetrievalErrorOptions {
  operation: HybridRetrievalOperation;
  componentId: string;
  cause?: unknown;
}
