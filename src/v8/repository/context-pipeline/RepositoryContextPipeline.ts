import {
  REPOSITORY_CONTEXT_PIPELINE_IDS,
  REPOSITORY_CONTEXT_PIPELINE_LIMITS,
  REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
} from "./constants";

import {
  repositoryContextPipelineInputSchema,
  repositoryContextPipelineResultSchema,
} from "./schema";

import type {
  ContextAssemblyStatus,
} from "../context-assembly/types";

import type {
  ContextSelectionStatus,
} from "../context-selection/types";

import type {
  HybridRetrievalStatus,
} from "../hybrid-retrieval/types";

import type {
  RepositoryContextPipelineDependencies,
  RepositoryContextPipelineInput,
  RepositoryContextPipelineResult,
  RepositoryContextPipelineStatus,
  RepositoryContextPipelineWarning,
  RepositoryContextPipelineStage,
} from "./types";

export class RepositoryContextPipeline {
  public readonly id =
    REPOSITORY_CONTEXT_PIPELINE_IDS
      .PIPELINE;

  constructor(
    private readonly dependencies:
      RepositoryContextPipelineDependencies,
  ) {}

  public async execute(
    rawInput:
      RepositoryContextPipelineInput,
  ): Promise<RepositoryContextPipelineResult> {
    const input =
      repositoryContextPipelineInputSchema
        .parse(
          rawInput,
        ) as RepositoryContextPipelineInput;

    const codeIndexChangeToken =
      input
        .codeIndexChangeToken ??
      input
        .repoGraph
        ?.codeIndexChangeToken ??
      input
        .repoMap
        ?.codeIndexChangeToken;

    const retrieval =
      await this.dependencies
        .retriever
        .retrieve({
          workspace:
            input.workspace,
          query:
            input.query,
          workspaceSnapshotId:
            input.snapshot
              .snapshotId,
          ...(codeIndexChangeToken
            ? {
                codeIndexChangeToken:
                  codeIndexChangeToken,
              }
            : {}),
          ...(input.rootIds
            ? {
                rootIds:
                  input.rootIds,
              }
            : {}),
          ...(input.folderPrefix
            ? {
                folderPrefix:
                  input
                    .folderPrefix,
              }
            : {}),
          ...(input.filePaths
            ? {
                filePaths:
                  input.filePaths,
              }
            : {}),
          ...(input.kinds
            ? {
                kinds:
                  input.kinds,
              }
            : {}),
          ...(input
            .maximumResults
            ? {
                maximumResults:
                  input
                    .maximumResults,
              }
            : {}),
          ...(input
            .maximumCandidatesPerSource
            ? {
                maximumCandidatesPerSource:
                  input
                    .maximumCandidatesPerSource,
              }
            : {}),
          ...(input.repoMap
            ? {
                repoMap:
                  input.repoMap,
              }
            : {}),
          ...(input.repoGraph
            ? {
                repoGraph:
                  input.repoGraph,
              }
            : {}),
          ...(input.abortSignal
            ? {
                abortSignal:
                  input
                    .abortSignal,
              }
            : {}),
        });

    const selection =
      this.dependencies
        .selector
        .select({
          query:
            input.query,
          retrieval,
          mode:
            input.mode,
          ...(input.breadth
            ? {
                breadth:
                  input.breadth,
              }
            : {}),
          ...(input.references
            ? {
                references:
                  input.references,
              }
            : {}),
          ...(input
            .selectionBudget
            ? {
                budget:
                  input
                    .selectionBudget,
              }
            : {}),
          ...(input.abortSignal
            ? {
                abortSignal:
                  input
                    .abortSignal,
              }
            : {}),
        });

    const assembly =
      await this.dependencies
        .assembler
        .assemble({
          selection,
          snapshot:
            input.snapshot,
          ...(input.abortSignal
            ? {
                abortSignal:
                  input
                    .abortSignal,
              }
            : {}),
        });

    const result:
      RepositoryContextPipelineResult = {
      schemaVersion:
        REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
      workspaceSnapshotId:
        input.snapshot
          .snapshotId,
      query:
        input.query,
      mode:
        input.mode,
      status:
        this.resolveStatus(
          retrieval.status,
          selection.status,
          assembly.status,
        ),
      retrieval,
      selection,
      assembly,
      warnings:
        this.collectWarnings(
          retrieval.warnings,
          selection.warnings,
          assembly.warnings,
        ),
      statistics: {
        retrievedCandidates:
          retrieval
            .candidates
            .length,
        selectedItems:
          selection
            .items
            .length,
        assembledBlocks:
          assembly
            .blocks
            .length,
        droppedBlocks:
          assembly
            .dropped
            .length,
        usedTokens:
          assembly
            .budget
            .usedTokens,
      },
    };

    return repositoryContextPipelineResultSchema
      .parse(
        result,
      ) as RepositoryContextPipelineResult;
  }

  private resolveStatus(
    retrieval:
      HybridRetrievalStatus,
    selection:
      ContextSelectionStatus,
    assembly:
      ContextAssemblyStatus,
  ): RepositoryContextPipelineStatus {
    if (
      assembly ===
        "cancelled" ||
      selection ===
        "cancelled" ||
      retrieval ===
        "cancelled"
    ) {
      return "cancelled";
    }

    if (
      assembly ===
      "failed"
    ) {
      return "failed";
    }

    if (
      assembly ===
      "empty"
    ) {
      return "empty";
    }

    if (
      assembly ===
        "partial" ||
      selection ===
        "partial" ||
      retrieval ===
        "partial" ||
      selection ===
        "failed" ||
      retrieval ===
        "failed"
    ) {
      return "partial";
    }

    return "complete";
  }

  private collectWarnings(
    retrievalWarnings:
      readonly {
        code: string;
        message: string;
      }[],
    selectionWarnings:
      readonly {
        code: string;
        message: string;
      }[],
    assemblyWarnings:
      readonly {
        code: string;
        message: string;
      }[],
  ): RepositoryContextPipelineWarning[] {
    const result:
      RepositoryContextPipelineWarning[] =
      [];

    const append = (
      stage:
        RepositoryContextPipelineStage,
      warnings:
        readonly {
          code: string;
          message: string;
        }[],
    ) => {
      for (
        const warning of
        warnings
      ) {
        if (
          result.length >=
          REPOSITORY_CONTEXT_PIPELINE_LIMITS
            .MAXIMUM_WARNINGS
        ) {
          return;
        }

        result.push({
          stage,
          code:
            warning.code,
          message:
            warning.message,
        });
      }
    };

    append(
      "retrieval",
      retrievalWarnings,
    );
    append(
      "selection",
      selectionWarnings,
    );
    append(
      "assembly",
      assemblyWarnings,
    );

    return result;
  }
}
