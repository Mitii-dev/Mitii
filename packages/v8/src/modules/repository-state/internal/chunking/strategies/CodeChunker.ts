import {
  CHUNKING_CODE_EXTENSIONS,
  CHUNKING_CODE_LANGUAGES,
  CHUNKING_IDS,
  CHUNKING_MESSAGES,
  CHUNKING_PATTERNS,
  CHUNKING_STRATEGY_PRIORITIES,
} from "../constants";

import {
  ChunkTextIndex,
} from "../ChunkTextIndex";

import type {
  ChunkingStrategy,
  ChunkingStrategyContext,
  ChunkingStrategyResult,
  ChunkingWarning,
  RawChunkSpan,
} from "../types";

export class CodeChunker
  implements ChunkingStrategy
{
  public readonly id =
    CHUNKING_IDS.CODE_STRATEGY;

  public readonly priority =
    CHUNKING_STRATEGY_PRIORITIES
      .CODE;

  public supports(
    context: ChunkingStrategyContext,
  ): boolean {
    if (
      context.sourceAnalysis &&
      context.sourceAnalysis
        .symbols.length > 0
    ) {
      return true;
    }

    if (
      context.language &&
      CHUNKING_CODE_LANGUAGES
        .has(
          context.language
            .toLowerCase(),
        )
    ) {
      return true;
    }

    return CHUNKING_CODE_EXTENSIONS
      .has(
        this.extensionOf(
          context.relativePath,
        ),
      );
  }

  public createSpans(
    context: ChunkingStrategyContext,
  ): ChunkingStrategyResult {
    const warnings:
      ChunkingWarning[] = [];

    const symbolSpans =
      this.createSymbolSpans(
        context,
      );

    if (
      symbolSpans.length > 0
    ) {
      return {
        spans:
          this.fillGaps(
            symbolSpans,
            context.content.length,
          ),
        warnings,
      };
    }

    if (
      context.sourceAnalysis &&
      context.sourceAnalysis
        .symbols.length > 0
    ) {
      warnings.push({
        code:
          "source_analysis_unusable",
        message:
          CHUNKING_MESSAGES
            .SOURCE_ANALYSIS_UNUSABLE,
        strategyId: this.id,
      });
    }

    return {
      spans:
        this.createDeclarationSpans(
          context.content,
        ),
      warnings,
    };
  }

  private createSymbolSpans(
    context: ChunkingStrategyContext,
  ): RawChunkSpan[] {
    const analysis =
      context.sourceAnalysis;

    if (
      !analysis ||
      (
        analysis.status !==
          "complete" &&
        analysis.status !==
          "partial"
      )
    ) {
      return [];
    }

    const textIndex =
      new ChunkTextIndex(
        context.content,
      );

    const spans:
      RawChunkSpan[] = [];

    for (
      const symbol of analysis
        .symbols
        .filter(
          (candidate) =>
            !candidate
              .parentLocalId,
        )
        .sort(
          (left, right) =>
            left.startLine -
              right.startLine ||
            (
              left.endLine ??
              left.startLine
            ) -
              (
                right.endLine ??
                right.startLine
              ) ||
            left.localId
              .localeCompare(
                right.localId,
              ),
        )
    ) {
      const startOffset =
        textIndex
          .lineStartOffset(
            symbol.startLine,
          );

      const endOffset =
        textIndex
          .lineEndOffsetExclusive(
            symbol.endLine ??
              symbol.startLine,
          );

      if (
        startOffset ===
          undefined ||
        endOffset === undefined ||
        endOffset <= startOffset
      ) {
        continue;
      }

      spans.push({
        startOffset,
        endOffset,
        kind: "code_symbol",
        title: symbol.name,
        symbolLocalId:
          symbol.localId,
      });
    }

    return this.removeOverlaps(
      spans,
    );
  }

  private createDeclarationSpans(
    content: string,
  ): RawChunkSpan[] {
    if (!content) {
      return [];
    }

    const lineStarts =
      this.collectLineStarts(
        content,
      );

    const boundaries:
      number[] = [0];

    for (
      const lineStart of lineStarts
    ) {
      const lineEnd =
        content.indexOf(
          "\n",
          lineStart,
        );

      const line =
        content.slice(
          lineStart,
          lineEnd === -1
            ? content.length
            : lineEnd,
        );

      if (
        lineStart > 0 &&
        (
          CHUNKING_PATTERNS
            .CODE_DECLARATION
            .test(line) ||
          CHUNKING_PATTERNS
            .CODE_NAMED_ASSIGNMENT
            .test(line)
        )
      ) {
        boundaries.push(
          lineStart,
        );
      }
    }

    return boundaries.map(
      (startOffset, index) => ({
        startOffset,
        endOffset:
          boundaries[index + 1] ??
          content.length,
        kind:
          index === 0 &&
          boundaries.length > 1
            ? "code_region"
            : "code_symbol",
      }),
    );
  }

  private fillGaps(
    symbolSpans: readonly RawChunkSpan[],
    contentLength: number,
  ): RawChunkSpan[] {
    const result:
      RawChunkSpan[] = [];

    let cursor = 0;

    for (
      const span of symbolSpans
    ) {
      if (
        span.startOffset > cursor
      ) {
        result.push({
          startOffset: cursor,
          endOffset:
            span.startOffset,
          kind: "code_region",
        });
      }

      result.push(span);

      cursor = Math.max(
        cursor,
        span.endOffset,
      );
    }

    if (cursor < contentLength) {
      result.push({
        startOffset: cursor,
        endOffset:
          contentLength,
        kind: "code_region",
      });
    }

    return result;
  }

  private removeOverlaps(
    spans: readonly RawChunkSpan[],
  ): RawChunkSpan[] {
    const result:
      RawChunkSpan[] = [];

    let lastEnd = -1;

    for (const span of spans) {
      if (
        span.startOffset <
        lastEnd
      ) {
        continue;
      }

      result.push(span);
      lastEnd = span.endOffset;
    }

    return result;
  }

  private collectLineStarts(
    content: string,
  ): number[] {
    const starts = [0];

    for (
      let index = 0;
      index < content.length;
      index += 1
    ) {
      if (
        content[index] ===
          "\n" &&
        index + 1 <
          content.length
      ) {
        starts.push(index + 1);
      }
    }

    return starts;
  }

  private extensionOf(
    relativePath: string,
  ): string {
    const normalized =
      relativePath
        .replace(/\\/g, "/")
        .toLowerCase();

    const basename =
      normalized.split("/")
        .pop() ?? normalized;

    const dot =
      basename.lastIndexOf(".");

    return dot >= 0
      ? basename.slice(dot)
      : "";
  }
}

