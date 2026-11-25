import {
  REPOSITORY_CONTEXT_PIPELINE_LIMITS,
  REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
} from "../../constants";
import { repositoryContextPipelineResultSchema } from "../../contracts/schema";
import type {
  RepositoryContextPipelineInput,
  RepositoryContextPipelineResult,
  RepositoryContextPipelineStage,
  RepositoryContextPipelineStatus,
  RepositoryContextPipelineWarning,
  RepositoryContextResolvedState,
} from "../../contracts/types";
import type {
  ContextAssemblyResult,
  ContextAssemblyStatus,
} from "../../helpers/context-assembly/types";
import type {
  ContextSelectionResult,
  ContextSelectionStatus,
} from "../../helpers/context-selection/types";
import type {
  HybridRetrievalResult,
  HybridRetrievalStatus,
} from "../../helpers/hybrid-retrieval/types";

export function finalizeRepositoryContextResult(params: {
  input: RepositoryContextPipelineInput;
  artifacts: RepositoryContextResolvedState;
  retrieval: HybridRetrievalResult;
  selection: ContextSelectionResult;
  assembly: ContextAssemblyResult;
  warnings: RepositoryContextPipelineWarning[];
}): RepositoryContextPipelineResult {
  const { input, artifacts, retrieval, selection, assembly, warnings } = params;

  const mergedWarnings = [
    ...warnings,
    ...collectStageWarnings(
      retrieval.warnings,
      selection.warnings,
      assembly.warnings,
    ),
  ];

  const result: RepositoryContextPipelineResult = {
    schemaVersion: REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
    stateToken: artifacts.descriptor.stateToken,
    workspaceSnapshotId: artifacts.descriptor.snapshotId,
    query: input.query,
    mode: input.mode,
    status: resolvePipelineStatus(
      retrieval.status,
      selection.status,
      assembly.status,
    ),
    retrieval,
    selection,
    assembly,
    warnings: mergedWarnings.slice(
      0,
      REPOSITORY_CONTEXT_PIPELINE_LIMITS.MAXIMUM_WARNINGS,
    ),
    statistics: {
      retrievedCandidates: retrieval.candidates.length,
      selectedItems: selection.items.length,
      assembledBlocks: assembly.blocks.length,
      droppedBlocks: assembly.dropped.length,
      usedTokens: assembly.budget.usedTokens,
    },
  };

  return repositoryContextPipelineResultSchema.parse(
    result,
  ) as RepositoryContextPipelineResult;
}

export function buildFailedRepositoryContextResult(params: {
  input: RepositoryContextPipelineInput;
  stateToken: string;
  workspaceSnapshotId: string;
  warnings: RepositoryContextPipelineWarning[];
}): RepositoryContextPipelineResult {
  const retrieval = emptyRetrieval(params.input.query);
  const selection = emptySelection(params.input.query, params.input.mode);
  const assembly = emptyAssembly(params.workspaceSnapshotId);

  return repositoryContextPipelineResultSchema.parse({
    schemaVersion: REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
    stateToken: params.stateToken,
    workspaceSnapshotId: params.workspaceSnapshotId,
    query: params.input.query,
    mode: params.input.mode,
    status: "failed",
    retrieval,
    selection,
    assembly,
    warnings: params.warnings,
    statistics: {
      retrievedCandidates: 0,
      selectedItems: 0,
      assembledBlocks: 0,
      droppedBlocks: 0,
      usedTokens: 0,
    },
  }) as RepositoryContextPipelineResult;
}

function resolvePipelineStatus(
  retrieval: HybridRetrievalStatus,
  selection: ContextSelectionStatus,
  assembly: ContextAssemblyStatus,
): RepositoryContextPipelineStatus {
  if (
    assembly === "cancelled" ||
    selection === "cancelled" ||
    retrieval === "cancelled"
  ) {
    return "cancelled";
  }
  if (assembly === "failed") return "failed";
  if (assembly === "empty") return "empty";
  if (
    assembly === "partial" ||
    selection === "partial" ||
    retrieval === "partial" ||
    selection === "failed" ||
    retrieval === "failed"
  ) {
    return "partial";
  }
  return "complete";
}

function collectStageWarnings(
  retrievalWarnings: readonly { code: string; message: string }[],
  selectionWarnings: readonly { code: string; message: string }[],
  assemblyWarnings: readonly { code: string; message: string }[],
): RepositoryContextPipelineWarning[] {
  const result: RepositoryContextPipelineWarning[] = [];
  const append = (
    stage: RepositoryContextPipelineStage,
    warnings: readonly { code: string; message: string }[],
  ) => {
    for (const warning of warnings) {
      if (result.length >= REPOSITORY_CONTEXT_PIPELINE_LIMITS.MAXIMUM_WARNINGS) {
        return;
      }
      result.push({ stage, code: warning.code, message: warning.message });
    }
  };
  append("retrieval", retrievalWarnings);
  append("selection", selectionWarnings);
  append("assembly", assemblyWarnings);
  return result;
}

function emptyRetrieval(query: string): HybridRetrievalResult {
  return {
    schemaVersion: 1,
    query,
    status: "failed",
    candidates: [],
    sourceReports: [],
    warnings: [],
    truncated: false,
    statistics: {
      configuredSources: 0,
      attemptedSources: 0,
      successfulSources: 0,
      failedSources: 0,
      skippedSources: 0,
      sourceCandidates: 0,
      uniqueCandidates: 0,
      duplicateCandidatesRemoved: 0,
      returnedCandidates: 0,
    },
  };
}

function emptySelection(
  query: string,
  mode: RepositoryContextPipelineInput["mode"],
): ContextSelectionResult {
  return {
    schemaVersion: 1,
    query,
    mode,
    breadth: "balanced",
    status: "failed",
    items: [],
    dropped: [],
    warnings: [],
    budget: {
      maximumTokens: 1,
      usedTokens: 0,
      remainingTokens: 1,
      maximumItems: 1,
      maximumFiles: 1,
      maximumItemsPerFile: 1,
    },
    statistics: {
      retrievedCandidates: 0,
      synthesizedReferences: 0,
      consideredCandidates: 0,
      selectedItems: 0,
      droppedItems: 0,
      selectedFiles: 0,
      selectedRoots: 0,
      requiredItems: 0,
      preferredItems: 0,
      supplementaryItems: 0,
      fullFileItems: 0,
      exactRangeItems: 0,
      targetedExcerptItems: 0,
      fileOutlineItems: 0,
      symbolSignatureItems: 0,
    },
  };
}

function emptyAssembly(workspaceSnapshotId: string): ContextAssemblyResult {
  return {
    schemaVersion: 1,
    workspaceSnapshotId,
    selectionStatus: "failed",
    status: "failed",
    blocks: [],
    dropped: [],
    warnings: [],
    budget: {
      allocatedTokens: 0,
      usedTokens: 0,
      remainingTokens: 0,
    },
    statistics: {
      selectedItems: 0,
      attemptedItems: 0,
      assembledBlocks: 0,
      droppedBlocks: 0,
      loadedFiles: 0,
      loadedRoots: 0,
      truncatedBlocks: 0,
      fallbackBlocks: 0,
      redactedBlocks: 0,
      redactionCount: 0,
      inputCharacters: 0,
      outputCharacters: 0,
    },
  };
}
