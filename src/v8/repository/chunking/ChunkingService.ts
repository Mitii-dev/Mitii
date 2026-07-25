import {
  CHUNKING_DEFAULTS,
  CHUNKING_ERRORS,
  CHUNKING_MESSAGES,
  CHUNKING_PATTERNS,
  CHUNKING_SCHEMA_VERSION,
} from "./constants";

import {
  chunkingResultSchema,
} from "./schema";

import {
  ChunkTextIndex,
} from "./ChunkTextIndex";

import type {
  ChunkingInput,
  ChunkingOptions,
  ChunkingResult,
  ChunkingServiceDependencies,
  ChunkingServicePort,
  ChunkingStatus,
  ChunkingStrategyContext,
  ChunkingWarning,
  ResolvedChunkingOptions,
} from "./types";

export class ChunkingService
  implements ChunkingServicePort
{
  constructor(
    private readonly dependencies:
      ChunkingServiceDependencies,

    private readonly defaultOptions:
      ChunkingOptions = {},
  ) {}

  public async chunk(
    input: ChunkingInput,
    options: ChunkingOptions = {},
  ): Promise<ChunkingResult> {
    this.validateInput(input);

    const resolvedOptions =
      this.resolveOptions({
        ...this.defaultOptions,
        ...options,
      });

    const sourceContentHash =
      input.contentHash ??
      this.dependencies
        .hasher.hash(
          input.content,
        );

    this.validateHash(
      sourceContentHash,
    );

    const inputCharacters =
      input.content.length;

    const inputLines =
      new ChunkTextIndex(
        input.content,
      ).lineCount;

    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.buildResult({
        input,
        sourceContentHash,
        status: "cancelled",
        processedCharacters: 0,
        inputCharacters,
        inputLines,
        chunks: [],
        warnings: [
          {
            code: "cancelled",
            message:
              CHUNKING_MESSAGES
                .CANCELLED,
          },
        ],
      });
    }

    if (
      input.content.length === 0
    ) {
      return this.buildResult({
        input,
        sourceContentHash,
        status: "empty",
        processedCharacters: 0,
        inputCharacters,
        inputLines,
        chunks: [],
        warnings: [],
      });
    }

    const overflow =
      input.content.length >
      resolvedOptions
        .maximumInputCharacters;

    if (
      overflow &&
      resolvedOptions
        .inputOverflowPolicy ===
        "reject"
    ) {
      return this.buildResult({
        input,
        sourceContentHash,
        status: "rejected",
        processedCharacters: 0,
        inputCharacters,
        inputLines,
        chunks: [],
        warnings: [
          {
            code:
              "input_rejected",
            message:
              CHUNKING_MESSAGES
                .INPUT_REJECTED,
          },
        ],
      });
    }

    const content = overflow
      ? this.safePrefix(
          input.content,
          resolvedOptions
            .maximumInputCharacters,
        )
      : input.content;

    const warnings:
      ChunkingWarning[] = [];

    if (overflow) {
      warnings.push({
        code: "input_truncated",
        message:
          CHUNKING_MESSAGES
            .INPUT_TRUNCATED,
      });
    }

    const sourceAnalysis =
      this.resolveSourceAnalysis(
        input,
        warnings,
      );

    const context:
      ChunkingStrategyContext = {
      sourceId: input.sourceId,
      rootId: input.rootId,
      relativePath:
        input.relativePath,
      content,
      options:
        resolvedOptions,
      ...(input.language
        ? {
            language:
              input.language,
          }
        : sourceAnalysis
            ?.language
          ? {
              language:
                sourceAnalysis
                  .language,
            }
          : {}),
      ...(sourceAnalysis
        ? {
            sourceAnalysis,
          }
        : {}),
      ...(input.abortSignal
        ? {
            abortSignal:
              input.abortSignal,
          }
        : {}),
    };

    const resolution =
      this.dependencies
        .registry.resolve(
          context,
        );

    let selectedStrategyId:
      string | undefined;

    let selectedChunks:
      ChunkingResult["chunks"] =
      [];

    let selectedPartial =
      overflow;

    for (
      const strategy of resolution
        .strategies
    ) {
      if (
        input.abortSignal
          ?.aborted
      ) {
        warnings.push({
          code: "cancelled",
          message:
            CHUNKING_MESSAGES
              .CANCELLED,
        });

        return this.buildResult({
          input,
          sourceContentHash,
          status: "cancelled",
          processedCharacters:
            content.length,
          inputCharacters,
          inputLines,
          chunks:
            selectedChunks,
          warnings,
          ...(selectedStrategyId
            ? {
                strategyId:
                  selectedStrategyId,
              }
            : {}),
        });
      }

      try {
        const strategyResult =
          await strategy
            .createSpans(
              context,
            );

        warnings.push(
          ...strategyResult
            .warnings,
        );

        const normalized =
          this.dependencies
            .normalizer.normalize({
              sourceId:
                input.sourceId,
              rootId:
                input.rootId,
              relativePath:
                input
                  .relativePath,
              sourceContentHash,
              content,
              strategyId:
                strategy.id,
              spans:
                strategyResult
                  .spans,
              options:
                resolvedOptions,
              ...(input
                .abortSignal
                ? {
                    abortSignal:
                      input
                        .abortSignal,
                  }
                : {}),
            });

        warnings.push(
          ...normalized.warnings,
        );

        if (
          normalized.cancelled
        ) {
          return this.buildResult({
            input,
            sourceContentHash,
            strategyId:
              strategy.id,
            status: "cancelled",
            processedCharacters:
              content.length,
            inputCharacters,
            inputLines,
            chunks:
              normalized.chunks,
            warnings,
          });
        }

        if (
          normalized.chunks
            .length === 0
        ) {
          warnings.push({
            code:
              "strategy_returned_empty",
            message:
              CHUNKING_MESSAGES
                .STRATEGY_RETURNED_EMPTY,
            strategyId:
              strategy.id,
          });

          selectedPartial = true;

          continue;
        }

        selectedStrategyId =
          strategy.id;

        selectedChunks =
          normalized.chunks;

        selectedPartial =
          selectedPartial ||
          normalized.truncated ||
          normalized.warnings
            .some(
              (warning) =>
                warning.code ===
                  "invalid_span" ||
                warning.code ===
                  "duplicate_span_removed",
            );

        break;
      } catch (error) {
        selectedPartial = true;

        warnings.push({
          code:
            "strategy_failed",
          strategyId:
            strategy.id,
          message:
            this.errorMessage(
              error,
            ),
        });
      }
    }

    if (!selectedStrategyId) {
      return this.buildResult({
        input,
        sourceContentHash,
        status: "failed",
        processedCharacters:
          content.length,
        inputCharacters,
        inputLines,
        chunks: [],
        warnings,
      });
    }

    const status:
      ChunkingStatus =
      selectedPartial
        ? "partial"
        : "complete";

    return this.buildResult({
      input,
      sourceContentHash,
      strategyId:
        selectedStrategyId,
      status,
      processedCharacters:
        content.length,
      inputCharacters,
      inputLines,
      chunks: selectedChunks,
      warnings,
    });
  }

  private resolveSourceAnalysis(
    input: ChunkingInput,
    warnings: ChunkingWarning[],
  ) {
    const analysis =
      input.sourceAnalysis;

    if (!analysis) {
      return undefined;
    }

    if (
      analysis.sourceId !==
        input.sourceId ||
      analysis.rootId !==
        input.rootId ||
      analysis.relativePath !==
        input.relativePath
    ) {
      warnings.push({
        code:
          "source_analysis_mismatch",
        message:
          CHUNKING_MESSAGES
            .SOURCE_ANALYSIS_MISMATCH,
      });

      return undefined;
    }

    return analysis;
  }

  private buildResult(
    input: {
      input: ChunkingInput;
      sourceContentHash: string;
      status: ChunkingStatus;
      processedCharacters: number;
      inputCharacters: number;
      inputLines: number;
      chunks: ChunkingResult["chunks"];
      warnings: ChunkingWarning[];
      strategyId?: string;
    },
  ): ChunkingResult {
    const result:
      ChunkingResult = {
      schemaVersion:
        CHUNKING_SCHEMA_VERSION,

      sourceId:
        input.input.sourceId,

      rootId:
        input.input.rootId,

      relativePath:
        input.input.relativePath,

      ...(input.input.language
        ? {
            language:
              input.input
                .language,
          }
        : input.input
            .sourceAnalysis
            ?.language
          ? {
              language:
                input.input
                  .sourceAnalysis
                  .language,
            }
          : {}),

      sourceContentHash:
        input.sourceContentHash,

      ...(input.strategyId
        ? {
            strategyId:
              input.strategyId,
          }
        : {}),

      status: input.status,
      chunks: input.chunks,
      warnings:
        input.warnings,

      statistics: {
        inputCharacters:
          input.inputCharacters,

        processedCharacters:
          input
            .processedCharacters,

        omittedCharacters:
          input.inputCharacters -
          input
            .processedCharacters,

        inputLines:
          input.inputLines,

        emittedChunks:
          input.chunks.length,

        estimatedTokens:
          input.chunks.reduce(
            (sum, chunk) =>
              sum +
              chunk
                .tokenEstimate,
            0,
          ),
      },
    };

    return chunkingResultSchema
      .parse(result) as
      ChunkingResult;
  }

  private resolveOptions(
    options: ChunkingOptions,
  ): ResolvedChunkingOptions {
    const resolved:
      ResolvedChunkingOptions = {
      maximumInputCharacters:
        options
          .maximumInputCharacters ??
        CHUNKING_DEFAULTS
          .MAXIMUM_INPUT_CHARACTERS,

      inputOverflowPolicy:
        options
          .inputOverflowPolicy ??
        CHUNKING_DEFAULTS
          .INPUT_OVERFLOW_POLICY,

      targetChunkCharacters:
        options
          .targetChunkCharacters ??
        CHUNKING_DEFAULTS
          .TARGET_CHUNK_CHARACTERS,

      maximumChunkCharacters:
        options
          .maximumChunkCharacters ??
        CHUNKING_DEFAULTS
          .MAXIMUM_CHUNK_CHARACTERS,

      minimumChunkCharacters:
        options
          .minimumChunkCharacters ??
        CHUNKING_DEFAULTS
          .MINIMUM_CHUNK_CHARACTERS,

      overlapCharacters:
        options
          .overlapCharacters ??
        CHUNKING_DEFAULTS
          .OVERLAP_CHARACTERS,

      boundarySearchCharacters:
        options
          .boundarySearchCharacters ??
        CHUNKING_DEFAULTS
          .BOUNDARY_SEARCH_CHARACTERS,

      maximumChunks:
        options.maximumChunks ??
        CHUNKING_DEFAULTS
          .MAXIMUM_CHUNKS,

      maximumTitleCharacters:
        options
          .maximumTitleCharacters ??
        CHUNKING_DEFAULTS
          .MAXIMUM_TITLE_CHARACTERS,
    };

    this.validatePositiveInteger(
      resolved
        .maximumInputCharacters,
      "maximumInputCharacters",
    );

    this.validatePositiveInteger(
      resolved
        .targetChunkCharacters,
      "targetChunkCharacters",
    );

    this.validatePositiveInteger(
      resolved
        .maximumChunkCharacters,
      "maximumChunkCharacters",
    );

    this.validatePositiveInteger(
      resolved
        .minimumChunkCharacters,
      "minimumChunkCharacters",
    );

    this.validateNonNegativeInteger(
      resolved
        .overlapCharacters,
      "overlapCharacters",
    );

    this.validatePositiveInteger(
      resolved
        .boundarySearchCharacters,
      "boundarySearchCharacters",
    );

    this.validatePositiveInteger(
      resolved.maximumChunks,
      "maximumChunks",
    );

    this.validatePositiveInteger(
      resolved
        .maximumTitleCharacters,
      "maximumTitleCharacters",
    );

    if (
      resolved
        .targetChunkCharacters >
      resolved
        .maximumChunkCharacters
    ) {
      throw new RangeError(
        CHUNKING_ERRORS
          .TARGET_EXCEEDS_MAXIMUM,
      );
    }

    if (
      resolved
        .minimumChunkCharacters >
      resolved
        .targetChunkCharacters
    ) {
      throw new RangeError(
        CHUNKING_ERRORS
          .MINIMUM_EXCEEDS_TARGET,
      );
    }

    if (
      resolved
        .overlapCharacters >=
      resolved
        .targetChunkCharacters
    ) {
      throw new RangeError(
        CHUNKING_ERRORS
          .OVERLAP_TOO_LARGE,
      );
    }

    return resolved;
  }

  private validateInput(
    input: ChunkingInput,
  ): void {
    if (!input.sourceId.trim()) {
      throw new TypeError(
        CHUNKING_ERRORS
          .SOURCE_ID_REQUIRED,
      );
    }

    if (!input.rootId.trim()) {
      throw new TypeError(
        CHUNKING_ERRORS
          .ROOT_ID_REQUIRED,
      );
    }

    const relativePath =
      input.relativePath;

    if (
      !relativePath ||
      relativePath
        .startsWith("/") ||
      relativePath
        .endsWith("/") ||
      relativePath
        .includes("\\") ||
      relativePath
        .split("/")
        .some(
          (segment) =>
            !segment ||
            segment === "." ||
            segment === "..",
        )
    ) {
      throw new TypeError(
        CHUNKING_ERRORS
          .RELATIVE_PATH_REQUIRED,
      );
    }

    if (input.contentHash) {
      this.validateHash(
        input.contentHash,
      );
    }
  }

  private validateHash(
    hash: string,
  ): void {
    if (
      !CHUNKING_PATTERNS
        .CONTENT_HASH.test(hash)
    ) {
      throw new TypeError(
        CHUNKING_ERRORS
          .HASH_INVALID,
      );
    }
  }

  private validatePositiveInteger(
    value: number,
    name: string,
  ): void {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value <= 0
    ) {
      throw new RangeError(
        `${name}: ${CHUNKING_ERRORS.POSITIVE_INTEGER_REQUIRED}`,
      );
    }
  }

  private validateNonNegativeInteger(
    value: number,
    name: string,
  ): void {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value < 0
    ) {
      throw new RangeError(
        `${name}: ${CHUNKING_ERRORS.NON_NEGATIVE_INTEGER_REQUIRED}`,
      );
    }
  }

  private safePrefix(
    content: string,
    maximumCharacters: number,
  ): string {
    let end =
      maximumCharacters;

    const character =
      content.charCodeAt(
        end - 1,
      );

    if (
      character >= 0xd800 &&
      character <= 0xdbff
    ) {
      end -= 1;
    }

    return content.slice(0, end);
  }

  private errorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}

