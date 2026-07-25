import {
  WORKSPACE_INDEXING_PIPELINE_IDS,
} from "./constants";

import type {
  WorkspaceIndexingFileProcessorDependencies,
  WorkspaceIndexingFileProcessorInput,
  WorkspaceIndexingFileResult,
  WorkspaceIndexingStage,
  WorkspaceIndexingWarning,
} from "./types";

import type {
  SourceAnalysis,
} from "../source-analysis/types";

import type {
  ChunkingResult,
} from "../chunking/types";

import type {
  CodeIndexCoordinatorResult,
} from "../code-indexing/types";

import type {
  TextIndexCoordinatorResult,
} from "../text-index/types";

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
      return this.cancelled(
        selected.file.rootId,
        selected.file
          .relativePath,
        selected.sourceId,
      );
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
      return this.failed({
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
      return this.cancelled(
        selected.file.rootId,
        selected.file
          .relativePath,
        selected.sourceId,
      );
    }

    const [
      analysisAttempt,
      hashAttempt,
    ] =
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
          Promise.resolve(
            this.dependencies
              .contentHasher
              .hash(
                source.content,
              ),
          ),
        ]);

    if (
      hashAttempt.status ===
      "rejected"
    ) {
      return this.failed({
        selected,
        stage:
          "content_hash",
        error:
          hashAttempt.reason,
      });
    }

    const contentHash =
      hashAttempt.value;
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
        this.warning({
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
        this.warning({
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
      return this.buildResult({
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
        this.warning({
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
        this.warning({
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

    return this.buildResult({
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

  private buildResult(
    input: {
      selected:
        WorkspaceIndexingFileProcessorInput[
          "selected"
        ];
      status:
        WorkspaceIndexingFileResult[
          "status"
        ];
      analysis?:
        SourceAnalysis;
      chunking?:
        ChunkingResult;
      codeIndex?:
        CodeIndexCoordinatorResult;
      textIndex?:
        TextIndexCoordinatorResult;
      warnings:
        WorkspaceIndexingWarning[];
    },
  ): WorkspaceIndexingFileResult {
    return {
      rootId:
        input.selected
          .file
          .rootId,
      relativePath:
        input.selected
          .file
          .relativePath,
      sourceId:
        input.selected
          .sourceId,
      status:
        input.status,
      ...(input.analysis
        ? {
            analysisStatus:
              input.analysis
                .status,
          }
        : {}),
      analysisWarnings:
        input.analysis
          ?.warnings
          .length ??
        0,
      ...(input.chunking
        ? {
            chunkingStatus:
              input.chunking
                .status,
          }
        : {}),
      chunkingWarnings:
        input.chunking
          ?.warnings
          .length ??
        0,
      emittedChunks:
        input.chunking
          ?.chunks
          .length ??
        0,
      estimatedTokens:
        input.chunking
          ?.statistics
          .estimatedTokens ??
        0,
      ...(input.codeIndex
        ? {
            codeIndexStatus:
              input.codeIndex
                .status,
          }
        : {}),
      codeIndexChanged:
        input.codeIndex
          ?.update
          ?.status ===
          "indexed" ||
        input.codeIndex
          ?.update
          ?.status ===
          "metadata_refreshed",
      ...(input.textIndex
        ? {
            textIndexStatus:
              input.textIndex
                .status,
          }
        : {}),
      textIndexChanged:
        input.textIndex
          ?.update
          ?.status ===
          "indexed" ||
        input.textIndex
          ?.update
          ?.status ===
          "metadata_refreshed",
      warnings:
        input.warnings,
    };
  }

  private failed(
    input: {
      selected:
        WorkspaceIndexingFileProcessorInput[
          "selected"
        ];
      stage:
        WorkspaceIndexingStage;
      error:
        unknown;
    },
  ): WorkspaceIndexingFileResult {
    return this.buildResult({
      selected:
        input.selected,
      status:
        "failed",
      warnings: [
        this.warning(
          input,
        ),
      ],
    });
  }

  private cancelled(
    rootId:
      string,
    relativePath:
      string,
    sourceId:
      string,
  ): WorkspaceIndexingFileResult {
    return {
      rootId,
      relativePath,
      sourceId,
      status:
        "cancelled",
      analysisWarnings:
        0,
      chunkingWarnings:
        0,
      emittedChunks:
        0,
      estimatedTokens:
        0,
      codeIndexChanged:
        false,
      textIndexChanged:
        false,
      warnings: [
        {
          stage:
            "read",
          code:
            "cancelled",
          message:
            "Workspace file indexing was cancelled.",
          rootId,
          relativePath,
        },
      ],
    };
  }

  private warning(
    input: {
      selected:
        WorkspaceIndexingFileProcessorInput[
          "selected"
        ];
      stage:
        WorkspaceIndexingStage;
      error:
        unknown;
    },
  ): WorkspaceIndexingWarning {
    return {
      stage:
        input.stage,
      code:
        "file_stage_failed",
      message:
        this.errorMessage(
          input.error,
        ),
      rootId:
        input.selected
          .file
          .rootId,
      relativePath:
        input.selected
          .file
          .relativePath,
    };
  }

  private errorMessage(
    error:
      unknown,
  ): string {
    return error
      instanceof Error
      ? error.message
      : String(
          error,
        );
  }
}
