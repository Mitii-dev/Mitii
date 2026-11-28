import {
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

import {
  cancelledResult,
  emptyFinalizeSelection,
  reportedFileResults,
  resolveCleanupAllowed,
  resolveStatus,
  summarizeStatistics,
} from "./WorkspaceIndexingResultSummary";

import {
  yieldIndexingEventLoop,
} from "./yieldEventLoop";

import type {
  NormalizedWorkspaceIndexingPipelineInput,
  WorkspaceIndexingFileResult,
  WorkspaceIndexingFileSelection,
  WorkspaceIndexingPipelineDependencies,
  WorkspaceIndexingPipelineInput,
  WorkspaceIndexingPipelineResult,
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
        cancelledResult(
          request,
        ),
      );
    }

    const selection =
      request.finalizeOnly
        ? emptyFinalizeSelection()
        : await this.selector
            .select(
              request,
            );

    const fileResults =
      request.finalizeOnly
        ? []
        : await this.processFiles(
            request,
            selection,
          );

    const cleanupWarnings:
      WorkspaceIndexingWarning[] =
      [];

    const cleanupAllowed =
      resolveCleanupAllowed(
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
      summarizeStatistics(
        selection,
        fileResults,
        rootResults,
      );

    const {
      reported,
      truncated,
    } =
      reportedFileResults(
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
        resolveStatus(
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
    let processed =
      0;

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
          processed +=
            1;

          await yieldIndexingEventLoop(
            processed,
          );

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
