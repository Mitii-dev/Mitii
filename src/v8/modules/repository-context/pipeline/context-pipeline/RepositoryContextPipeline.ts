import {
  REPOSITORY_CONTEXT_PIPELINE_IDS,
  REPOSITORY_CONTEXT_PIPELINE_LIMITS,
  REPOSITORY_CONTEXT_PIPELINE_MESSAGES,
  REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
} from "./constants";

import {
  repositoryContextPipelineInputSchema,
  repositoryContextPipelineResultSchema,
} from "./schema";

import type { ContextAssemblyResult, ContextAssemblyStatus } from "../../internal/context-assembly/types";

import type { ContextSelectionResult, ContextSelectionStatus } from "../../internal/context-selection/types";

import type { HybridRetrievalResult, HybridRetrievalStatus } from "../../internal/hybrid-retrieval/types";

import type {
  RepositoryContextPipelineDependencies,
  RepositoryContextPipelineInput,
  RepositoryContextPipelineResult,
  RepositoryContextPipelineStatus,
  RepositoryContextPipelineWarning,
  RepositoryContextPipelineStage,
  RepositoryContextResolvedState,
} from "./types";

function deriveCodeIndexChangeToken(
  artifacts: RepositoryContextResolvedState,
): string | undefined {
  if (artifacts.repoGraph?.codeIndexChangeToken) {
    return artifacts.repoGraph.codeIndexChangeToken;
  }
  if (artifacts.repoMap?.codeIndexChangeToken) {
    return artifacts.repoMap.codeIndexChangeToken;
  }

  const revisions = artifacts.descriptor.roots
    .map((root) => root.codeIndexRevision)
    .filter((revision): revision is string => Boolean(revision));

  return revisions.length > 0 ? revisions.join("|") : undefined;
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

function emptyAssembly(
  workspaceSnapshotId: string,
): ContextAssemblyResult {
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

/**
 * Primary Repository Context facade.
 * Accepts only a published state reference; artifacts are resolved through
 * the injected state resolver so callers cannot mix independent revisions.
 */
export class RepositoryContextPipeline {
  public readonly id = REPOSITORY_CONTEXT_PIPELINE_IDS.PIPELINE;

  constructor(
    private readonly dependencies: RepositoryContextPipelineDependencies,
  ) {}

  public async execute(
    rawInput: RepositoryContextPipelineInput,
  ): Promise<RepositoryContextPipelineResult> {
    const input = repositoryContextPipelineInputSchema.parse(
      rawInput,
    ) as RepositoryContextPipelineInput;

    const resolved = await this.dependencies.stateResolver.resolve(
      input.state,
    );

    if (resolved.status === "not_found") {
      return this.failedResult({
        input,
        stateToken: input.state.stateToken,
        workspaceSnapshotId: "unresolved",
        warnings: [
          {
            stage: "state_resolution",
            code: resolved.code,
            message: resolved.message,
          },
        ],
      });
    }

    if (resolved.status === "unavailable") {
      return this.failedResult({
        input,
        stateToken: resolved.descriptor.stateToken,
        workspaceSnapshotId: resolved.descriptor.snapshotId,
        warnings: [
          {
            stage: "state_resolution",
            code: resolved.code,
            message: resolved.message,
          },
        ],
      });
    }

    const artifacts = resolved.artifacts;
    const warnings: RepositoryContextPipelineWarning[] = [];

    if (artifacts.descriptor.readiness === "unavailable") {
      return this.failedResult({
        input,
        stateToken: artifacts.descriptor.stateToken,
        workspaceSnapshotId: artifacts.descriptor.snapshotId,
        warnings: [
          {
            stage: "state_resolution",
            code: "state_unavailable",
            message: REPOSITORY_CONTEXT_PIPELINE_MESSAGES.STATE_UNAVAILABLE,
          },
        ],
      });
    }

    if (artifacts.descriptor.readiness === "degraded") {
      warnings.push({
        stage: "state_resolution",
        code: "state_degraded",
        message: REPOSITORY_CONTEXT_PIPELINE_MESSAGES.STATE_DEGRADED,
      });
    }

    const codeIndexChangeToken = deriveCodeIndexChangeToken(artifacts);

    const retrieval = await this.dependencies.retriever.retrieve({
      workspace: artifacts.descriptor.workspaceId,
      query: input.query,
      workspaceSnapshotId: artifacts.descriptor.snapshotId,
      ...(codeIndexChangeToken
        ? {
            codeIndexChangeToken,
          }
        : {}),
      ...(input.rootIds
        ? {
            rootIds: input.rootIds,
          }
        : {}),
      ...(input.folderPrefix
        ? {
            folderPrefix: input.folderPrefix,
          }
        : {}),
      ...(input.filePaths
        ? {
            filePaths: input.filePaths,
          }
        : {}),
      ...(input.kinds
        ? {
            kinds: input.kinds,
          }
        : {}),
      ...(input.maximumResults
        ? {
            maximumResults: input.maximumResults,
          }
        : {}),
      ...(input.maximumCandidatesPerSource
        ? {
            maximumCandidatesPerSource: input.maximumCandidatesPerSource,
          }
        : {}),
      ...(artifacts.repoMap
        ? {
            repoMap: artifacts.repoMap,
          }
        : {}),
      ...(artifacts.repoGraph
        ? {
            repoGraph: artifacts.repoGraph,
          }
        : {}),
      ...(input.abortSignal
        ? {
            abortSignal: input.abortSignal,
          }
        : {}),
    });

    const selection = this.dependencies.selector.select({
      query: input.query,
      retrieval,
      mode: input.mode,
      ...(input.breadth
        ? {
            breadth: input.breadth,
          }
        : {}),
      ...(input.references
        ? {
            references: input.references,
          }
        : {}),
      ...(input.selectionBudget
        ? {
            budget: input.selectionBudget,
          }
        : {}),
      ...(input.abortSignal
        ? {
            abortSignal: input.abortSignal,
          }
        : {}),
    });

    const assembly = await this.dependencies.assembler.assemble({
      selection,
      snapshot: artifacts.snapshot,
      ...(input.abortSignal
        ? {
            abortSignal: input.abortSignal,
          }
        : {}),
    });

    warnings.push(
      ...this.collectWarnings(
        retrieval.warnings,
        selection.warnings,
        assembly.warnings,
      ),
    );

    const result: RepositoryContextPipelineResult = {
      schemaVersion: REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
      stateToken: artifacts.descriptor.stateToken,
      workspaceSnapshotId: artifacts.descriptor.snapshotId,
      query: input.query,
      mode: input.mode,
      status: this.resolveStatus(
        retrieval.status,
        selection.status,
        assembly.status,
      ),
      retrieval,
      selection,
      assembly,
      warnings: warnings.slice(
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

  private failedResult(input: {
    input: RepositoryContextPipelineInput;
    stateToken: string;
    workspaceSnapshotId: string;
    warnings: RepositoryContextPipelineWarning[];
  }): RepositoryContextPipelineResult {
    const retrieval = emptyRetrieval(input.input.query);
    const selection = emptySelection(input.input.query, input.input.mode);
    const assembly = emptyAssembly(input.workspaceSnapshotId);

    return repositoryContextPipelineResultSchema.parse({
      schemaVersion: REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
      stateToken: input.stateToken,
      workspaceSnapshotId: input.workspaceSnapshotId,
      query: input.input.query,
      mode: input.input.mode,
      status: "failed",
      retrieval,
      selection,
      assembly,
      warnings: input.warnings,
      statistics: {
        retrievedCandidates: 0,
        selectedItems: 0,
        assembledBlocks: 0,
        droppedBlocks: 0,
        usedTokens: 0,
      },
    }) as RepositoryContextPipelineResult;
  }

  private resolveStatus(
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

    if (assembly === "failed") {
      return "failed";
    }

    if (assembly === "empty") {
      return "empty";
    }

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

  private collectWarnings(
    retrievalWarnings: readonly {
      code: string;
      message: string;
    }[],
    selectionWarnings: readonly {
      code: string;
      message: string;
    }[],
    assemblyWarnings: readonly {
      code: string;
      message: string;
    }[],
  ): RepositoryContextPipelineWarning[] {
    const result: RepositoryContextPipelineWarning[] = [];

    const append = (
      stage: RepositoryContextPipelineStage,
      warnings: readonly {
        code: string;
        message: string;
      }[],
    ) => {
      for (const warning of warnings) {
        if (
          result.length >= REPOSITORY_CONTEXT_PIPELINE_LIMITS.MAXIMUM_WARNINGS
        ) {
          return;
        }

        result.push({
          stage,
          code: warning.code,
          message: warning.message,
        });
      }
    };

    append("retrieval", retrievalWarnings);
    append("selection", selectionWarnings);
    append("assembly", assemblyWarnings);

    return result;
  }
}
