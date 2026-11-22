import {
  WORKSPACE_INDEXING_PIPELINE_IDS,
} from "./constants";

import {
  tryBuildUnchangedResult,
  tryBuildUnchangedResultFromCatalog,
} from "./WorkspaceIndexingFileFreshness";

import {
  buildCancelledFileResult,
  buildFailedFileResult,
  buildFileResult,
  buildFileWarning,
} from "./WorkspaceIndexingFileResultBuilders";

import type {
  WorkspaceIndexingFileProcessorDependencies,
  WorkspaceIndexingFileProcessorInput,
  WorkspaceIndexingFileResult,
  WorkspaceIndexingWarning,
} from "./types";

import type {
  SourceAnalysis,
} from "../../internal/source-analysis/types";

import type {
  ChunkingResult,
} from "../../internal/chunking/types";

import type {
  CodeIndexCoordinatorResult,
} from "../../internal/code-indexing/types";

import type {
  TextIndexCoordinatorResult,
} from "../../internal/text-index/types";

export class WorkspaceIndexingFileProcessor {
  public readonly id =
    WORKSPACE_INDEXING_PIPELINE_IDS
      .FILE_PROCESSOR;

  constructor(
    private readonly dependencies:
      WorkspaceIndexingFileProcessorDependencies,
  ) {}

  public async process(
    input:
      WorkspaceIndexingFileProcessorInput,
  ): Promise<WorkspaceIndexingFileResult> {
    const {
      request,
      selected,
    } = input;

    if (
      request.abortSignal
        ?.aborted
    ) {
      return buildCancelledFileResult(
        selected.file.rootId,
        selected.file
          .relativePath,
        selected.sourceId,
      );
    }

    const catalogFresh =
      await tryBuildUnchangedResultFromCatalog(
        this.dependencies.freshness,
        input,
      );

    if (catalogFresh) {
      return catalogFresh;
    }

    let source;

    try {
      source =
        await this.dependencies
          .reader
          .read({
            sourceId:
              selected.sourceId,
            file:
              selected.file,
          });
    } catch (
      error
    ) {
      return buildFailedFileResult({
        selected,
        stage:
          "read",
        error,
      });
    }

    if (
      request.abortSignal
        ?.aborted
    ) {
      return buildCancelledFileResult(
        selected.file.rootId,
        selected.file
          .relativePath,
        selected.sourceId,
      );
    }

    let contentHash: string;

    try {
      contentHash =
        await this.dependencies
          .contentHasher
          .hash(
            source.content,
          );
    } catch (
      error
    ) {
      return buildFailedFileResult({
        selected,
        stage:
          "content_hash",
        error,
      });
    }

    const unchanged =
      await tryBuildUnchangedResult({
        freshness:
          this.dependencies
            .freshness,
        input,
        contentHash,
      });

    if (unchanged) {
      return unchanged;
    }

    const analysisAttempt =
      await Promise
        .allSettled([
          this.dependencies
            .analyzer
            .analyze({
              sourceId:
                selected.sourceId,
              file:
                selected.file,
              content:
                source.content,
              ...(selected.language
                ? {
                    language:
                      selected
                        .language,
                  }
                : {}),
              ...(request.abortSignal
                ? {
                    abortSignal:
                      request
                        .abortSignal,
                  }
                : {}),
            }),
        ])
        .then(
          ([result]) =>
            result,
        );

    const warnings:
      WorkspaceIndexingWarning[] =
      [];

    let analysis:
      SourceAnalysis |
      undefined;

    if (
      analysisAttempt.status ===
      "fulfilled"
    ) {
      analysis =
        analysisAttempt.value;
    } else {
      warnings.push(
        buildFileWarning({
          selected,
          stage:
            "analysis",
          error:
            analysisAttempt
              .reason,
        }),
      );
    }

    let chunking:
      ChunkingResult |
      undefined;

    try {
      chunking =
        await this.dependencies
          .chunker
          .chunk(
            {
              sourceId:
                selected.sourceId,
              rootId:
                selected.file
                  .rootId,
              relativePath:
                selected.file
                  .relativePath,
              content:
                source.content,
              contentHash,
              ...(
                analysis
                  ?.language
                  ? {
                      language:
                        analysis
                          .language,
                    }
                  : selected.language
                    ? {
                        language:
                          selected
                            .language,
                      }
                    : {}
              ),
              ...(analysis
                ? {
                    sourceAnalysis:
                      analysis,
                  }
                : {}),
              ...(request.abortSignal
                ? {
                    abortSignal:
                      request
                        .abortSignal,
                  }
                : {}),
            },
            request
              .chunkingOptions,
          );
    } catch (
      error
    ) {
      warnings.push(
        buildFileWarning({
          selected,
          stage:
            "chunking",
          error,
        }),
      );
    }

    if (
      request.abortSignal
        ?.aborted ||
      chunking?.status ===
        "cancelled"
    ) {
      return buildFileResult({
        selected,
        status:
          "cancelled",
        ...(analysis
          ? {
              analysis,
            }
          : {}),
        ...(chunking
          ? {
              chunking,
            }
          : {}),
        warnings: [
          ...warnings,
          {
            stage:
              "chunking",
            code:
              "cancelled",
            message:
              "Workspace file indexing was cancelled.",
            rootId:
              selected.file
                .rootId,
            relativePath:
              selected.file
                .relativePath,
          },
        ],
      });
    }

    const codePromise =
      analysis
        ? this.dependencies
            .codeIndexer
            .index({
              workspace:
                request
                  .workspace,
              snapshot:
                request
                  .snapshot,
              file:
                selected
                  .file,
              analysis,
              contentHash,
              analysisVersion:
                request
                  .analysisVersion,
              indexedAt:
                request
                  .indexedAt,
              ...(request.abortSignal
                ? {
                    abortSignal:
                      request
                        .abortSignal,
                  }
                : {}),
            })
        : undefined;

    const textPromise =
      chunking
        ? this.dependencies
            .textIndexer
            .index({
              workspace:
                request
                  .workspace,
              workspaceSnapshotId:
                request
                  .snapshot
                  .snapshotId,
              indexedAt:
                request
                  .indexedAt,
              pipelineVersion:
                request
                  .textPipelineVersion,
              chunking,
              ...(request.abortSignal
                ? {
                    abortSignal:
                      request
                        .abortSignal,
                  }
                : {}),
            })
        : undefined;

    const [
      codeAttempt,
      textAttempt,
    ] =
      await Promise
        .all([
          this.settle(
            codePromise,
          ),
          this.settle(
            textPromise,
          ),
        ]);

    let codeIndex:
      CodeIndexCoordinatorResult |
      undefined;
    let textIndex:
      TextIndexCoordinatorResult |
      undefined;

    if (
      codeAttempt
        ?.status ===
      "fulfilled"
    ) {
      codeIndex =
        codeAttempt.value;
    } else if (
      codeAttempt
    ) {
      warnings.push(
        buildFileWarning({
          selected,
          stage:
            "code_index",
          error:
            codeAttempt.reason,
        }),
      );
    }

    if (
      textAttempt
        ?.status ===
      "fulfilled"
    ) {
      textIndex =
        textAttempt.value;
    } else if (
      textAttempt
    ) {
      warnings.push(
        buildFileWarning({
          selected,
          stage:
            "text_index",
          error:
            textAttempt.reason,
        }),
      );
    }

    const cancelled =
      request.abortSignal
        ?.aborted ||
      textIndex?.status ===
        "cancelled";

    const usefulCodeState =
      codeIndex !==
        undefined &&
      codeIndex.status !==
        "analysis_failed";

    const usefulTextState =
      textIndex !==
        undefined &&
      textIndex.status !==
        "not_indexable" &&
      textIndex.status !==
        "cancelled";

    const usefulWrite =
      usefulCodeState ||
      usefulTextState;

    const incomplete =
      warnings.length > 0 ||
      analysis?.status ===
        "failed" ||
      analysis?.status ===
        "partial" ||
      !analysis ||
      !chunking ||
      chunking.status ===
        "partial" ||
      chunking.status ===
        "failed" ||
      chunking.status ===
        "rejected" ||
      codeIndex?.status ===
        "analysis_failed" ||
      textIndex?.status ===
        "not_indexable";

    return buildFileResult({
      selected,
      status:
        cancelled
          ? "cancelled"
          : !usefulWrite
            ? "failed"
            : incomplete
              ? "partial"
              : "complete",
      ...(analysis
        ? {
            analysis,
          }
        : {}),
      ...(chunking
        ? {
            chunking,
          }
        : {}),
      ...(codeIndex
        ? {
            codeIndex,
          }
        : {}),
      ...(textIndex
        ? {
            textIndex,
          }
        : {}),
      warnings,
    });
  }

  private async settle<T>(
    promise:
      Promise<T> |
      undefined,
  ): Promise<
    PromiseSettledResult<T> |
    undefined
  > {
    if (
      !promise
    ) {
      return undefined;
    }

    const [
      result,
    ] =
      await Promise
        .allSettled([
          promise,
        ]);

    return result;
  }

}
