import type { ContextSelectionReferences } from "../helpers/context-selection/types";

export type HybridRetrievalRankingContext = {
  currentFile?: string;
  openFiles?: string[];
  gitDiffFiles?: string[];
  diagnosticFiles?: string[];
  recentEditFiles?: string[];
  staleFiles?: string[];
  priorityPaths?: string[];
};

/** Shared DTO between prepare-retrieval and retrieve steps. */
export type PreparedRepositoryContextRetrieval = {
  codeIndexChangeToken: string | undefined;
  focusedReferences: ContextSelectionReferences | undefined;
  anchorFilePaths: string[];
  rankingContext: HybridRetrievalRankingContext | undefined;
};
