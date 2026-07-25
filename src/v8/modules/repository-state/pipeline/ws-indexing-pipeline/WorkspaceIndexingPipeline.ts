import {
  WORKSPACE_INDEXING_FILE_RESULT_SEVERITY,
  WORKSPACE_INDEXING_PIPELINE_IDS,
  WORKSPACE_INDEXING_PIPELINE_LIMITS,
  WORKSPACE_INDEXING_PIPELINE_MESSAGES,
  WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION,
} from "./constants";

import {
  workspaceIndexingPipelineResultSchema,
} from "./schema";

import {
  WorkspaceIndexingFileProcessor,
} from "./WorkspaceIndexingFileProcessor";

import {
  WorkspaceIndexingFileSelector,
} from "./WorkspaceIndexingFileSelector";

import {
  WorkspaceIndexingRequestNormalizer,
} from "./WorkspaceIndexingRequestNormalizer";

import {
  WorkspaceIndexingRootFinalizer,
} from "./WorkspaceIndexingRootFinalizer";

import type {
  NormalizedWorkspaceIndexingPipelineInput,
  WorkspaceIndexingFileResult,
  WorkspaceIndexingFileSelection,
  WorkspaceIndexingPipelineDependencies,
  WorkspaceIndexingPipelineInput,
  WorkspaceIndexingPipelineResult,
  WorkspaceIndexingPipelineStatistics,
  WorkspaceIndexingPipelineStatus,
  WorkspaceIndexingRootResult,
  WorkspaceIndexingWarning,
} from "./types";

export class WorkspaceIndexingPipeline {
  public readonly id =
    WORKSPACE_INDEXING_PIPELINE_IDS
      .PIPELINE;

  private readonly normalizer =
    new WorkspaceIndexingRequestNormalizer();

  private readonly selector:
    WorkspaceIndexingFileSelector;

  private readonly processor:
    WorkspaceIndexingFileProcessor;

  private readonly finalizer:
    WorkspaceIndexingRootFinalizer;

  constructor(
    dependencies:
      WorkspaceIndexingPipelineDependencies,
  ) {
    this.selector =
      new WorkspaceIndexingFileSelector(
        dependencies
          .filePolicy,
      );

    this.processor =
      new WorkspaceIndexingFileProcessor(
        dependencies,
      );

    this.finalizer =
      new WorkspaceIndexingRootFinalizer(
        dependencies,
      );
  }

  public async execute(
    rawInput:
      WorkspaceIndexingPipelineInput,
  ): Promise<WorkspaceIndexingPipelineResult> {
    const request =
      this.normalizer
        .normalize(
          rawInput,
        );

    if (
      request.abortSignal
        ?.aborted
    ) {
      return this.validate(
        this.cancelledResult(
          request,
        ),
      );
    }

    const selection =
      await this.selector
        .select(
          request,
        );

    const fileResults =
      await this.processFiles(
        request,
        selection,
      );

    const cleanupWarnings:
      WorkspaceIndexingWarning[] =
      [];

    const cleanupAllowed =
      this.resolveCleanupAllowed(
        request,
        selection,
        fileResults,
        cleanupWarnings,
      );

    const roots =
      request.snapshot
        .roots
        .filter(
          (root) =>
            request.rootIds
              .length ===
              0 ||
            request.rootIds
              .includes(
                root.id,
              ),
        );

    const rootResults =
      await this.finalizer
        .finalize({
          request,
          roots,
          cleanupAllowed,
          retainedRelativePathsByRoot:
            selection
              .retainedRelativePathsByRoot,
        });

    const statistics =
      this.statistics(
        selection,
        fileResults,
        rootResults,
      );

    const {
      reported,
      truncated,
    } =
      this.reportedFileResults(
        fileResults,
        request
          .maximumReportedFileResults,
      );

    const warnings =
      this.collectWarnings(
        [
          ...selection
            .warnings,
          ...fileResults
            .flatMap(
              (result) =>
                result.warnings,
            ),
          ...cleanupWarnings,
          ...rootResults
            .flatMap(
              (result) =>
                result.warnings,
            ),
          ...(truncated
            ? [
                {
                  stage:
                    "selection" as const,
                  code:
                    "file_results_truncated" as const,
                  message:
                    WORKSPACE_INDEXING_PIPELINE_MESSAGES
                      .FILE_RESULTS_TRUNCATED,
                },
              ]
            : []),
        ],
      );

    const result:
      WorkspaceIndexingPipelineResult = {
      schemaVersion:
        WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION,
      workspace:
        request.workspace,
      workspaceSnapshotId:
        request.snapshot
          .snapshotId,
      indexedAt:
        request.indexedAt,
      status:
        this.resolveStatus(
          request,
          selection,
          fileResults,
          rootResults,
        ),
      fileResults:
        reported,
      fileResultsTruncated:
        truncated,
      rootResults,
      warnings,
      cleanupAllowed,
      statistics: {
        ...statistics,
        reportedFileResults:
          reported.length,
      },
    };

    return this.validate(
      result,
    );
  }

  private async processFiles(
    request:
      NormalizedWorkspaceIndexingPipelineInput,
    selection:
      WorkspaceIndexingFileSelection,
  ): Promise<WorkspaceIndexingFileResult[]> {
    const results:
      Array<
        WorkspaceIndexingFileResult |
        undefined
      > =
      new Array(
        selection
          .selected
          .length,
      );

    let cursor =
      0;
    let stopped =
      false;

    const worker =
      async () => {
        while (
          !stopped
        ) {
          if (
            request
              .abortSignal
              ?.aborted
          ) {
            stopped =
              true;

            return;
          }

          const index =
            cursor;
          cursor +=
            1;

          const selected =
            selection
              .selected[
              index
            ];

          if (
            !selected
          ) {
            return;
          }

          const result =
            await this.processor
              .process({
                request,
                selected,
              });

          results[index] =
            result;

          if (
            request
              .failureMode ===
              "fail_fast" &&
            result.status ===
              "failed"
          ) {
            stopped =
              true;
          }
        }
      };

    const workerCount =
      Math.min(
        request
          .concurrency,
        selection
          .selected
          .length,
      );

    await Promise.all(
      Array.from(
        {
          length:
            workerCount,
        },
        () =>
          worker(),
      ),
    );

    return results.filter(
      (
        result,
      ): result is
        WorkspaceIndexingFileResult =>
        result !==
        undefined,
    );
  }

  private resolveCleanupAllowed(
    request:
      NormalizedWorkspaceIndexingPipelineInput,
    selection:
      WorkspaceIndexingFileSelection,
    fileResults:
      readonly WorkspaceIndexingFileResult[],
    warnings:
      WorkspaceIndexingWarning[],
  ): boolean {
    if (
      !request
        .cleanupMissing
    ) {
      return false;
    }

    if (
      request.snapshot
        .status !==
      "complete"
    ) {
      warnings.push({
        stage:
          "cleanup",
        code:
          "cleanup_skipped",
        message:
          WORKSPACE_INDEXING_PIPELINE_MESSAGES
            .CLEANUP_PARTIAL_SNAPSHOT,
      });

      return false;
    }

    if (
      request.filePaths
        .length > 0
    ) {
      warnings.push({
        stage:
          "cleanup",
        code:
          "cleanup_skipped",
        message:
          WORKSPACE_INDEXING_PIPELINE_MESSAGES
            .CLEANUP_FILTERED_RUN,
      });

      return false;
    }

    if (
      selection.warnings
        .some(
          (warning) =>
            warning.code ===
            "file_policy_failed",
        )
    ) {
      warnings.push({
        stage:
          "cleanup",
        code:
          "cleanup_skipped",
        message:
          WORKSPACE_INDEXING_PIPELINE_MESSAGES
            .CLEANUP_POLICY_FAILURE,
      });

      return false;
    }

    if (
      selection.truncated ||
      fileResults.length !==
        selection.selected
          .length
    ) {
      warnings.push({
        stage:
          "cleanup",
        code:
          "cleanup_skipped",
        message:
          WORKSPACE_INDEXING_PIPELINE_MESSAGES
            .CLEANUP_TRUNCATED_RUN,
      });

      return false;
    }

    return !request
      .abortSignal
      ?.aborted;
  }

  private statistics(
    selection:
      WorkspaceIndexingFileSelection,
    fileResults:
      readonly WorkspaceIndexingFileResult[],
    rootResults:
      readonly WorkspaceIndexingRootResult[],
  ): Omit<
    WorkspaceIndexingPipelineStatistics,
    "reportedFileResults"
  > {
    const countStatus =
      (
        status:
          WorkspaceIndexingFileResult[
            "status"
          ],
      ) =>
        fileResults.filter(
          (result) =>
            result.status ===
            status,
        ).length;

    return {
      availableFiles:
        selection
          .availableFiles,
      selectedFiles:
        selection
          .selected
          .length,
      skippedFiles:
        selection
          .skipped
          .length,
      processedFiles:
        fileResults.length,
      completeFiles:
        countStatus(
          "complete",
        ),
      partialFiles:
        countStatus(
          "partial",
        ),
      failedFiles:
        countStatus(
          "failed",
        ),
      cancelledFiles:
        countStatus(
          "cancelled",
        ),
      analysisFailures:
        fileResults.filter(
          (result) =>
            result
              .analysisStatus ===
              "failed" ||
            result.warnings
              .some(
                (warning) =>
                  warning.stage ===
                  "analysis",
              ),
        ).length,
      emittedChunks:
        fileResults.reduce(
          (
            total,
            result,
          ) =>
            total +
            result
              .emittedChunks,
          0,
        ),
      estimatedTokens:
        fileResults.reduce(
          (
            total,
            result,
          ) =>
            total +
            result
              .estimatedTokens,
          0,
        ),
      codeIndexUpdates:
        fileResults.filter(
          (result) =>
            result
              .codeIndexChanged,
        ).length,
      textIndexUpdates:
        fileResults.filter(
          (result) =>
            result
              .textIndexChanged,
        ).length,
      embeddedChunks:
        rootResults.reduce(
          (
            total,
            result,
          ) =>
            total +
            result
              .embeddedChunks,
          0,
        ),
      removedCodeIndexFiles:
        rootResults.reduce(
          (
            total,
            result,
          ) =>
            total +
            result
              .codeIndexRemovedFiles,
          0,
        ),
      removedTextIndexDocuments:
        rootResults.reduce(
          (
            total,
            result,
          ) =>
            total +
            result
              .textIndexRemovedDocuments,
          0,
        ),
      removedTextIndexChunks:
        rootResults.reduce(
          (
            total,
            result,
          ) =>
            total +
            result
              .textIndexRemovedChunks,
          0,
        ),
    };
  }

  private reportedFileResults(
    results:
      readonly WorkspaceIndexingFileResult[],
    maximum:
      number,
  ): {
    reported:
      WorkspaceIndexingFileResult[];
    truncated:
      boolean;
  } {
    const ordered =
      [...results]
        .sort(
          (
            left,
            right,
          ) =>
            WORKSPACE_INDEXING_FILE_RESULT_SEVERITY[
              left.status
            ] -
              WORKSPACE_INDEXING_FILE_RESULT_SEVERITY[
                right.status
              ] ||
            left.rootId
              .localeCompare(
                right.rootId,
              ) ||
            left.relativePath
              .localeCompare(
                right
                  .relativePath,
              ),
        );

    return {
      reported:
        ordered.slice(
          0,
          maximum,
        ),
      truncated:
        ordered.length >
        maximum,
    };
  }

  private collectWarnings(
    warnings:
      readonly WorkspaceIndexingWarning[],
  ): WorkspaceIndexingWarning[] {
    return warnings.slice(
      0,
      WORKSPACE_INDEXING_PIPELINE_LIMITS
        .MAXIMUM_WARNINGS,
    );
  }

  private resolveStatus(
    request:
      NormalizedWorkspaceIndexingPipelineInput,
    selection:
      WorkspaceIndexingFileSelection,
    fileResults:
      readonly WorkspaceIndexingFileResult[],
    rootResults:
      readonly WorkspaceIndexingRootResult[],
  ): WorkspaceIndexingPipelineStatus {
    if (
      request.abortSignal
        ?.aborted ||
      rootResults.some(
        (result) =>
          result.status ===
          "cancelled",
      )
    ) {
      return "cancelled";
    }

    const failedFiles =
      fileResults.filter(
        (result) =>
          result.status ===
          "failed",
      ).length;

    if (
      request.failureMode ===
        "fail_fast" &&
      failedFiles > 0
    ) {
      return "failed";
    }

    const rootDidWork =
      rootResults.some(
        (result) =>
          result
            .cleanupPerformed ||
          result.embeddingStatus !==
            undefined,
      );

    if (
      selection.selected
        .length === 0 &&
      !rootDidWork
    ) {
      return "empty";
    }

    if (
      request.snapshot
        .status !==
        "complete" ||
      selection.truncated ||
      fileResults.length !==
        selection.selected
          .length ||
      fileResults.some(
        (result) =>
          result.status !==
          "complete",
      ) ||
      rootResults.some(
        (result) =>
          result.status ===
          "partial",
      )
    ) {
      return "partial";
    }

    return "complete";
  }

  private cancelledResult(
    request:
      NormalizedWorkspaceIndexingPipelineInput,
  ): WorkspaceIndexingPipelineResult {
    return {
      schemaVersion:
        WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION,
      workspace:
        request.workspace,
      workspaceSnapshotId:
        request.snapshot
          .snapshotId,
      indexedAt:
        request.indexedAt,
      status:
        "cancelled",
      fileResults:
        [],
      fileResultsTruncated:
        false,
      rootResults:
        [],
      warnings: [
        {
          stage:
            "selection",
          code:
            "cancelled",
          message:
            "Workspace indexing was cancelled before file selection.",
        },
      ],
      cleanupAllowed:
        false,
      statistics:
        this.emptyStatistics(),
    };
  }

  private emptyStatistics():
    WorkspaceIndexingPipelineStatistics {
    return {
      availableFiles:
        0,
      selectedFiles:
        0,
      skippedFiles:
        0,
      processedFiles:
        0,
      completeFiles:
        0,
      partialFiles:
        0,
      failedFiles:
        0,
      cancelledFiles:
        0,
      analysisFailures:
        0,
      emittedChunks:
        0,
      estimatedTokens:
        0,
      codeIndexUpdates:
        0,
      textIndexUpdates:
        0,
      embeddedChunks:
        0,
      removedCodeIndexFiles:
        0,
      removedTextIndexDocuments:
        0,
      removedTextIndexChunks:
        0,
      reportedFileResults:
        0,
    };
  }

  private validate(
    result:
      WorkspaceIndexingPipelineResult,
  ): WorkspaceIndexingPipelineResult {
    return workspaceIndexingPipelineResultSchema
      .parse(
        result,
      ) as WorkspaceIndexingPipelineResult;
  }
}
