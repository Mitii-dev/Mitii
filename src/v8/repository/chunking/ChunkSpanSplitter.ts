import {
  CHUNKING_BOUNDARIES,
} from "./constants";

import type {
  RawChunkSpan,
  ResolvedChunkingOptions,
} from "./types";

export class ChunkSpanSplitter {
  public split(
    content: string,
    span: RawChunkSpan,
    options: ResolvedChunkingOptions,
  ): RawChunkSpan[] {
    if (
      span.endOffset -
        span.startOffset <=
      options
        .maximumChunkCharacters
    ) {
      return [span];
    }

    const result:
      RawChunkSpan[] = [];

    let start =
      span.startOffset;

    while (
      start < span.endOffset
    ) {
      const remaining =
        span.endOffset - start;

      if (
        remaining <=
        options
          .maximumChunkCharacters
      ) {
        result.push({
          ...span,
          startOffset: start,
          endOffset:
            span.endOffset,
        });

        break;
      }

      const maximumEnd =
        Math.min(
          span.endOffset,
          start +
            options
              .maximumChunkCharacters,
        );

      const targetEnd =
        Math.min(
          maximumEnd,
          start +
            options
              .targetChunkCharacters,
        );

      let end =
        this.findBoundary(
          content,
          start,
          targetEnd,
          maximumEnd,
          options,
        );

      if (
        span.endOffset - end <
        options
          .minimumChunkCharacters
      ) {
        end = span.endOffset;
      }

      if (end <= start) {
        end = maximumEnd;
      }

      result.push({
        ...span,
        startOffset: start,
        endOffset: end,
      });

      if (
        end >= span.endOffset
      ) {
        break;
      }

      const overlappedStart =
        end -
        options
          .overlapCharacters;

      start = Math.max(
        start + 1,
        overlappedStart,
      );
    }

    return result;
  }

  private findBoundary(
    content: string,
    start: number,
    targetEnd: number,
    maximumEnd: number,
    options: ResolvedChunkingOptions,
  ): number {
    const minimumBoundary =
      Math.max(
        start +
          options
            .minimumChunkCharacters,
        targetEnd -
          options
            .boundarySearchCharacters,
      );

    const preferred = [
      CHUNKING_BOUNDARIES
        .PARAGRAPH,
      CHUNKING_BOUNDARIES.LINE,
      CHUNKING_BOUNDARIES
        .WHITESPACE,
    ];

    for (
      const boundary of preferred
    ) {
      const index =
        content.lastIndexOf(
          boundary,
          maximumEnd - 1,
        );

      if (
        index >= minimumBoundary
      ) {
        return Math.min(
          maximumEnd,
          index +
            boundary.length,
        );
      }
    }

    return maximumEnd;
  }
}

