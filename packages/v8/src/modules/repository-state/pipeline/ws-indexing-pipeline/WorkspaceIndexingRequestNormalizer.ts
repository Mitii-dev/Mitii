import {
  WORKSPACE_INDEXING_PIPELINE_DEFAULTS,
} from "./constants";

import {
  workspaceIndexingPipelineInputSchema,
} from "./schema";

import type {
  NormalizedWorkspaceIndexingPipelineInput,
  WorkspaceIndexingPipelineInput,
} from "./types";

export class WorkspaceIndexingRequestNormalizer {
  public normalize(
    rawInput:
      WorkspaceIndexingPipelineInput,
  ): NormalizedWorkspaceIndexingPipelineInput {
    const input =
      workspaceIndexingPipelineInputSchema
        .parse(
          rawInput,
        ) as WorkspaceIndexingPipelineInput;

    return {
      workspace:
        input.workspace
          .trim(),
      snapshot:
        input.snapshot,
      indexedAt:
        input.indexedAt,
      rootIds:
        this.uniqueSorted(
          input.rootIds ??
          [],
        ),
      filePaths:
        this.uniqueSorted(
          input.filePaths ??
          [],
        ),
      maximumFiles:
        input.maximumFiles ??
        WORKSPACE_INDEXING_PIPELINE_DEFAULTS
          .MAXIMUM_FILES,
      concurrency:
        input.concurrency ??
        WORKSPACE_INDEXING_PIPELINE_DEFAULTS
          .CONCURRENCY,
      maximumReportedFileResults:
        input
          .maximumReportedFileResults ??
        WORKSPACE_INDEXING_PIPELINE_DEFAULTS
          .MAXIMUM_REPORTED_FILE_RESULTS,
      analysisVersion:
        input.analysisVersion
          ?.trim() ??
        WORKSPACE_INDEXING_PIPELINE_DEFAULTS
          .ANALYSIS_VERSION,
      textPipelineVersion:
        input
          .textPipelineVersion
          ?.trim() ??
        WORKSPACE_INDEXING_PIPELINE_DEFAULTS
          .TEXT_PIPELINE_VERSION,
      chunkingOptions: {
        ...(
          input
            .chunkingOptions ??
          {}
        ),
      },
      failureMode:
        input.failureMode ??
        WORKSPACE_INDEXING_PIPELINE_DEFAULTS
          .FAILURE_MODE,
      cleanupMissing:
        input.cleanupMissing ??
        WORKSPACE_INDEXING_PIPELINE_DEFAULTS
          .CLEANUP_MISSING,
      synchronizeEmbeddings:
        input
          .synchronizeEmbeddings ??
        WORKSPACE_INDEXING_PIPELINE_DEFAULTS
          .SYNCHRONIZE_EMBEDDINGS,
      ...(input.abortSignal
        ? {
            abortSignal:
              input
                .abortSignal,
          }
        : {}),
    };
  }

  private uniqueSorted(
    values:
      readonly string[],
  ): string[] {
    return [
      ...new Set(
        values.map(
          (value) =>
            value.trim(),
        ),
      ),
    ].sort(
      (
        left,
        right,
      ) =>
        left.localeCompare(
          right,
        ),
    );
  }
}
