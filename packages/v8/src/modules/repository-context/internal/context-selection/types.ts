import type {
  AgentMode,
} from "../../../request-intake";

import type {
  HybridRetrievalCandidate,
  HybridRetrievalResult,
  RetrievalEntityKind,
} from "../hybrid-retrieval/types";

/**
 * REQUEST
 */

export type ContextSelectionMode =
  AgentMode;

export type ContextSelectionBreadth =
  | "focused"
  | "balanced"
  | "broad";

export interface ContextFileReference {
  rootId?: string;
  relativePath: string;
}

export type ContextReferencePriority =
  | "required"
  | "preferred"
  | "supplementary";

export interface PinnedContextReference
  extends ContextFileReference {
  priority?: ContextReferencePriority;
}

export interface EditorSelectionReference
  extends ContextFileReference {
  startLine: number;
  endLine: number;

  /**
   * True when the request explicitly refers to the selected code.
   */
  explicitlyReferenced?: boolean;
}

export interface NormalizedPinnedContextReference
  extends ContextFileReference {
  priority: ContextReferencePriority;
}

export interface NormalizedEditorSelectionReference
  extends ContextFileReference {
  startLine: number;
  endLine: number;
  explicitlyReferenced: boolean;
}

export interface ContextSelectionReferences {
  explicitFiles?: readonly ContextFileReference[];
  pinnedFiles?: readonly PinnedContextReference[];

  currentFile?: ContextFileReference;
  currentSelection?: EditorSelectionReference;

  openFiles?: readonly ContextFileReference[];
  gitDiffFiles?: readonly ContextFileReference[];
  diagnosticFiles?: readonly ContextFileReference[];
  recentEditFiles?: readonly ContextFileReference[];
}

export interface ContextSelectionBudget {
  maximumTokens?: number;
  maximumItems?: number;
  maximumFiles?: number;
  maximumItemsPerFile?: number;
  minimumItems?: number;
  minimumScore?: number;
}

export interface ContextSelectionInput {
  query: string;
  retrieval: HybridRetrievalResult;

  mode?: ContextSelectionMode;
  breadth?: ContextSelectionBreadth;

  references?: ContextSelectionReferences;
  budget?: ContextSelectionBudget;

  abortSignal?: AbortSignal;
}

export interface NormalizedContextSelectionBudget {
  maximumTokens: number;
  maximumItems: number;
  maximumFiles: number;
  maximumItemsPerFile: number;
  minimumItems: number;
  minimumScore: number;
}

export interface NormalizedContextSelectionRequest {
  query: string;
  retrieval: HybridRetrievalResult;

  mode: ContextSelectionMode;
  breadth: ContextSelectionBreadth;

  references: {
    explicitFiles: ContextFileReference[];
    pinnedFiles: NormalizedPinnedContextReference[];

    currentFile?: ContextFileReference;
    currentSelection?: NormalizedEditorSelectionReference;

    openFiles: ContextFileReference[];
    gitDiffFiles: ContextFileReference[];
    diagnosticFiles: ContextFileReference[];
    recentEditFiles: ContextFileReference[];
  };

  budget: NormalizedContextSelectionBudget;
}

export interface ContextSelectionNormalization {
  request?: NormalizedContextSelectionRequest;
  warnings: ContextSelectionWarning[];
}

/**
 * INTERNAL CANDIDATES
 */

export type ContextCandidateOrigin =
  | "retrieval"
  | "explicit_file"
  | "pinned_file"
  | "current_file"
  | "current_selection"
  | "open_file"
  | "git_diff"
  | "diagnostic"
  | "recent_edit";

export interface ContextCandidate {
  key: string;
  entityKind: RetrievalEntityKind;

  rootId?: string;
  relativePath: string;

  chunkId?: string;
  symbolId?: string;

  startLine?: number;
  endLine?: number;

  retrievalCandidate?: HybridRetrievalCandidate;

  origins: ContextCandidateOrigin[];
  priority: ContextReferencePriority;
}

export type ContextSelectionScoreSignalType =
  | "retrieval_score"
  | "multi_source_agreement"
  | "query_path_match"
  | "explicit_file"
  | "pinned_file"
  | "current_file"
  | "current_selection"
  | "open_file"
  | "git_diff"
  | "diagnostic"
  | "recent_edit"
  | "required_priority"
  | "diversity_penalty";

export interface ContextSelectionScoreSignal {
  type: ContextSelectionScoreSignalType;
  score: number;
  evidence: string;
}

export type ContextRepresentation =
  | "full_file"
  | "exact_range"
  | "targeted_excerpt"
  | "file_outline"
  | "symbol_signature";

export interface ContextRepresentationOption {
  representation: ContextRepresentation;
  estimatedTokens: number;
  quality: number;
}

export interface ContextRepresentationPlan {
  options: ContextRepresentationOption[];
  usedDefaultEstimate: boolean;
}

export interface ScoredContextCandidate {
  candidate: ContextCandidate;

  score: number;
  utilityScore: number;

  signals: ContextSelectionScoreSignal[];
  representationOptions: ContextRepresentationOption[];
  usedDefaultEstimate: boolean;
}

/**
 * OUTPUT
 */

export interface SelectedContextItem {
  key: string;
  origin: ContextCandidateOrigin[];
  priority: ContextReferencePriority;

  entityKind: RetrievalEntityKind;
  rootId?: string;
  relativePath: string;

  chunkId?: string;
  symbolId?: string;
  startLine?: number;
  endLine?: number;

  retrievalCandidate?: HybridRetrievalCandidate;

  representation: ContextRepresentation;

  /**
   * Hard allowance for ContextAssembly when loading this item.
   */
  allocatedTokens: number;
  estimatedTokens: number;

  score: number;
  selectionOrder: number;
  signals: ContextSelectionScoreSignal[];
}

export type ContextSelectionDropCause =
  | "excluded_path"
  | "duplicate"
  | "low_score"
  | "covered_by_full_file"
  | "token_budget"
  | "item_limit"
  | "file_limit"
  | "per_file_limit"
  | "required_reference_omitted";

export interface DroppedContextItem {
  key: string;
  relativePath: string;
  cause: ContextSelectionDropCause;
  priority: ContextReferencePriority;
  score: number;
  estimatedTokens: number;
  evidence: string;
}

export type ContextSelectionWarningCode =
  | "empty_query"
  | "query_truncated"
  | "duplicate_reference_removed"
  | "upstream_retrieval_partial"
  | "upstream_retrieval_failed"
  | "excluded_path_removed"
  | "token_budget_reached"
  | "item_limit_reached"
  | "file_limit_reached"
  | "per_file_limit_reached"
  | "required_reference_omitted"
  | "representation_downgraded"
  | "unknown_token_estimate";

export interface ContextSelectionWarning {
  code: ContextSelectionWarningCode;
  message: string;
  count?: number;
  key?: string;
  relativePath?: string;
}

export type ContextSelectionStatus =
  | "complete"
  | "partial"
  | "empty"
  | "cancelled"
  | "failed";

export interface ContextSelectionBudgetUsage {
  maximumTokens: number;
  usedTokens: number;
  remainingTokens: number;

  maximumItems: number;
  maximumFiles: number;
  maximumItemsPerFile: number;
}

export interface ContextSelectionStatistics {
  retrievedCandidates: number;
  synthesizedReferences: number;
  consideredCandidates: number;

  selectedItems: number;
  droppedItems: number;
  selectedFiles: number;
  selectedRoots: number;

  requiredItems: number;
  preferredItems: number;
  supplementaryItems: number;

  fullFileItems: number;
  exactRangeItems: number;
  targetedExcerptItems: number;
  fileOutlineItems: number;
  symbolSignatureItems: number;
}

export interface ContextSelectionResult {
  schemaVersion: 1;
  query: string;
  mode: ContextSelectionMode;
  breadth: ContextSelectionBreadth;

  status: ContextSelectionStatus;

  items: SelectedContextItem[];
  dropped: DroppedContextItem[];
  warnings: ContextSelectionWarning[];

  budget: ContextSelectionBudgetUsage;
  statistics: ContextSelectionStatistics;
}

/**
 * COMPONENT RESULTS
 */

export interface ContextCandidatePreparation {
  candidates: ContextCandidate[];
  dropped: DroppedContextItem[];
  warnings: ContextSelectionWarning[];
  synthesizedReferences: number;
}

export interface ContextScoringInput {
  candidate: ContextCandidate;
  request: NormalizedContextSelectionRequest;
}

export interface ContextDiversityRankingInput {
  candidates: readonly ScoredContextCandidate[];
  mode: ContextSelectionMode;
  breadth: ContextSelectionBreadth;
  abortSignal?: AbortSignal;
}

export interface ContextDiversityRankingResult {
  candidates: ScoredContextCandidate[];
  cancelled: boolean;
}

export interface ContextBudgetAllocationInput {
  candidates: readonly ScoredContextCandidate[];
  budget: NormalizedContextSelectionBudget;
  abortSignal?: AbortSignal;
}

export interface ContextBudgetAllocationResult {
  items: SelectedContextItem[];
  dropped: DroppedContextItem[];
  warnings: ContextSelectionWarning[];
  usedTokens: number;
  cancelled: boolean;
  requiredOmitted: boolean;
}

/**
 * OPTIONS
 */

export type RequiredContextOverflowMode =
  | "partial"
  | "fail";

export interface ContextSelectorOptions {
  requiredOverflowMode?: RequiredContextOverflowMode;
}

export interface ResolvedContextSelectorOptions {
  requiredOverflowMode: RequiredContextOverflowMode;
}

/**
 * ERRORS
 */

export type ContextSelectionOperation =
  | "normalize_request"
  | "prepare_candidates"
  | "score_candidates"
  | "rank_diversity"
  | "allocate_budget"
  | "select";

export interface ContextSelectionErrorOptions {
  operation: ContextSelectionOperation;
  componentId: string;
  cause?: unknown;
}
