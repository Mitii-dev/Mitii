import { CHUNKING_MESSAGES } from "./constants";
import { ChunkTextIndex } from "./ChunkTextIndex";
import {
  buildChunkingResult,
  chunkingErrorMessage,
  resolveChunkingSourceAnalysis,
  safeChunkingPrefix,
} from "./buildChunkingResult";
import { resolveChunkingOptions } from "./resolveChunkingOptions";
import {
  validateChunkingHash,
  validateChunkingInput,
} from "./validateChunkingInput";
import type {
  ChunkingInput,
  ChunkingOptions,
  ChunkingResult,
  ChunkingServiceDependencies,
  ChunkingServicePort,
  ChunkingStatus,
  ChunkingStrategyContext,
  ChunkingWarning,
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
    validateChunkingInput(input);

    const resolvedOptions =
      resolveChunkingOptions({
        ...this.defaultOptions,
        ...options,
      });

    const sourceContentHash =
      input.contentHash ??
      this.dependencies
        .hasher.hash(
          input.content,
        );

    validateChunkingHash(
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
      return buildChunkingResult({
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
      return buildChunkingResult({
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
      return buildChunkingResult({
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
      ? safeChunkingPrefix(
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
      resolveChunkingSourceAnalysis(
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

        return buildChunkingResult({
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
          return buildChunkingResult({
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
            chunkingErrorMessage(
              error,
            ),
        });
      }
    }

    if (!selectedStrategyId) {
      return buildChunkingResult({
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

    return buildChunkingResult({
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
}
