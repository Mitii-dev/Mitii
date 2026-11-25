import {
  CHUNKING_MESSAGES,
} from "./constants";

import {
  ChunkIdBuilder,
} from "./ChunkIdBuilder";

import {
  ChunkSpanSplitter,
} from "./ChunkSpanSplitter";

import {
  ChunkTextIndex,
} from "./ChunkTextIndex";

import type {
  Chunk,
  ChunkContentHasher,
  ChunkNormalizationInput,
  ChunkNormalizationResult,
  ChunkNormalizerPort,
  ChunkTokenEstimator,
  ChunkingWarning,
  RawChunkSpan,
} from "./types";

export class ChunkNormalizer
  implements ChunkNormalizerPort
{
  private readonly idBuilder:
    ChunkIdBuilder;

  constructor(
    private readonly hasher:
      ChunkContentHasher,

    private readonly tokenEstimator:
      ChunkTokenEstimator,

    private readonly splitter =
      new ChunkSpanSplitter(),
  ) {
    this.idBuilder =
      new ChunkIdBuilder(
        hasher,
      );
  }

  public normalize(
    input: ChunkNormalizationInput,
  ): ChunkNormalizationResult {
    const warnings:
      ChunkingWarning[] = [];

    const textIndex =
      new ChunkTextIndex(
        input.content,
      );

    const acceptedSpans =
      this.acceptSpans(
        input,
        warnings,
      );

    const splitSpans =
      acceptedSpans.flatMap(
        (span) =>
          span.contentOverride ===
            undefined
            ? this.splitter.split(
                input.content,
                span,
                input.options,
              )
            : [span],
      );

    const chunks: Chunk[] = [];
    let truncated = false;
    let cancelled = false;

    for (
      const span of splitSpans
    ) {
      if (
        input.abortSignal
          ?.aborted
      ) {
        cancelled = true;

        warnings.push({
          code: "cancelled",
          message:
            CHUNKING_MESSAGES
              .CANCELLED,
        });

        break;
      }

      if (
        chunks.length >=
        input.options
          .maximumChunks
      ) {
        truncated = true;

        warnings.push({
          code:
            "chunks_truncated",
          message:
            CHUNKING_MESSAGES
              .CHUNKS_TRUNCATED,
        });

        break;
      }

      const trimmed =
        span.contentOverride ===
          undefined
          ? this.trimSpan(
              input.content,
              span,
            )
          : span;

      if (!trimmed) {
        continue;
      }

      const chunkContent =
        trimmed.contentOverride ??
        input.content.slice(
          trimmed.startOffset,
          trimmed.endOffset,
        );

      if (
        chunkContent.trim().length === 0
      ) {
        continue;
      }

      const contentHash =
        this.hasher.hash(
          chunkContent,
        );

      const ordinal =
        chunks.length;

      const chunk: Chunk = {
        id:
          this.idBuilder.build({
            sourceId:
              input.sourceId,
            rootId:
              input.rootId,
            relativePath:
              input.relativePath,
            sourceContentHash:
              input
                .sourceContentHash,
            strategyId:
              input.strategyId,
            kind:
              trimmed.kind,
            startOffset:
              trimmed
                .startOffset,
            endOffset:
              trimmed
                .endOffset,
            contentHash,
          }),

        sourceId:
          input.sourceId,

        rootId:
          input.rootId,

        relativePath:
          input.relativePath,

        strategyId:
          input.strategyId,

        ordinal,
        kind: trimmed.kind,

        content:
          chunkContent,

        sourceContentHash:
          input
            .sourceContentHash,

        contentHash,

        tokenEstimate:
          this.tokenEstimator
            .estimate(
              chunkContent,
            ),

        startOffset:
          trimmed.startOffset,

        endOffset:
          trimmed.endOffset,

        startLine:
          textIndex
            .lineAtOffset(
              trimmed
                .startOffset,
            ),

        endLine:
          textIndex
            .lineAtOffset(
              trimmed
                .endOffset - 1,
            ),

        ...(trimmed.title
          ? {
              title:
                this.limitTitle(
                  trimmed.title,
                  input.options
                    .maximumTitleCharacters,
                ),
            }
          : {}),

        ...(trimmed
          .symbolLocalId
          ? {
              symbolLocalId:
                trimmed
                  .symbolLocalId,
            }
          : {}),
      };

      chunks.push(chunk);
    }

    return {
      chunks,
      warnings,
      truncated,
      cancelled,
    };
  }

  private acceptSpans(
    input: ChunkNormalizationInput,
    warnings: ChunkingWarning[],
  ): RawChunkSpan[] {
    const result:
      RawChunkSpan[] = [];

    const seen =
      new Set<string>();

    const ordered = [
      ...input.spans,
    ].sort(
      (left, right) =>
        left.startOffset -
          right.startOffset ||
        left.endOffset -
          right.endOffset ||
        left.kind.localeCompare(
          right.kind,
        ),
    );

    for (
      const span of ordered
    ) {
      if (
        !this.isValidSpan(
          span,
          input.content.length,
        )
      ) {
        warnings.push({
          code: "invalid_span",
          message:
            CHUNKING_MESSAGES
              .INVALID_SPAN,
          strategyId:
            input.strategyId,
          ...(Number.isSafeInteger(
            span.startOffset,
          ) &&
          span.startOffset >= 0
            ? {
                startOffset:
                  span.startOffset,
              }
            : {}),
          ...(Number.isSafeInteger(
            span.endOffset,
          ) &&
          span.endOffset > 0
            ? {
                endOffset:
                  span.endOffset,
              }
            : {}),
        });

        continue;
      }

      const key = [
        span.startOffset,
        span.endOffset,
        span.kind,
        span.symbolLocalId ??
          "",
      ].join(":");

      if (seen.has(key)) {
        warnings.push({
          code:
            "duplicate_span_removed",
          message:
            CHUNKING_MESSAGES
              .DUPLICATE_SPAN,
          strategyId:
            input.strategyId,
          startOffset:
            span.startOffset,
          endOffset:
            span.endOffset,
        });

        continue;
      }

      seen.add(key);
      result.push(span);
    }

    return result;
  }

  private isValidSpan(
    span: RawChunkSpan,
    contentLength: number,
  ): boolean {
    return (
      Number.isSafeInteger(
        span.startOffset,
      ) &&
      Number.isSafeInteger(
        span.endOffset,
      ) &&
      span.startOffset >= 0 &&
      span.endOffset >
        span.startOffset &&
      span.endOffset <=
        contentLength
    );
  }

  private trimSpan(
    content: string,
    span: RawChunkSpan,
  ): RawChunkSpan | null {
    let start =
      span.startOffset;

    let end =
      span.endOffset;

    while (
      start < end &&
      /\s/.test(
        content[start] ?? "",
      )
    ) {
      start += 1;
    }

    while (
      end > start &&
      /\s/.test(
        content[end - 1] ??
          "",
      )
    ) {
      end -= 1;
    }

    if (end <= start) {
      return null;
    }

    return {
      ...span,
      startOffset: start,
      endOffset: end,
    };
  }

  private limitTitle(
    title: string,
    maximumCharacters: number,
  ): string {
    const normalized =
      title
        .replace(/\s+/g, " ")
        .trim();

    return normalized.length <=
      maximumCharacters
      ? normalized
      : normalized.slice(
          0,
          maximumCharacters,
        );
  }
}

