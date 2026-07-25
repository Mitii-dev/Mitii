import {
  CHUNKING_IDS,
  CHUNKING_MARKDOWN_EXTENSIONS,
  CHUNKING_MARKDOWN_LANGUAGES,
  CHUNKING_PATTERNS,
  CHUNKING_STRATEGY_PRIORITIES,
} from "../constants";

import type {
  ChunkingStrategy,
  ChunkingStrategyContext,
  ChunkingStrategyResult,
  RawChunkSpan,
} from "../types";

interface MarkdownBoundary {
  offset: number;
  title?: string;
}

export class MarkdownChunker
  implements ChunkingStrategy
{
  public readonly id =
    CHUNKING_IDS
      .MARKDOWN_STRATEGY;

  public readonly priority =
    CHUNKING_STRATEGY_PRIORITIES
      .MARKDOWN;

  public supports(
    context: ChunkingStrategyContext,
  ): boolean {
    if (
      context.language &&
      CHUNKING_MARKDOWN_LANGUAGES
        .has(
          context.language
            .toLowerCase(),
        )
    ) {
      return true;
    }

    return CHUNKING_MARKDOWN_EXTENSIONS
      .has(
        this.extensionOf(
          context.relativePath,
        ),
      );
  }

  public createSpans(
    context: ChunkingStrategyContext,
  ): ChunkingStrategyResult {
    if (!context.content) {
      return {
        spans: [],
        warnings: [],
      };
    }

    const boundaries:
      MarkdownBoundary[] = [
        {
          offset: 0,
        },
      ];

    let lineStart = 0;

    while (
      lineStart <
      context.content.length
    ) {
      const newline =
        context.content.indexOf(
          "\n",
          lineStart,
        );

      const lineEnd =
        newline === -1
          ? context.content.length
          : newline;

      const line =
        context.content
          .slice(
            lineStart,
            lineEnd,
          )
          .replace(/\r$/, "");

      const match =
        CHUNKING_PATTERNS
          .MARKDOWN_HEADING
          .exec(line);

      if (
        match &&
        lineStart > 0
      ) {
        boundaries.push({
          offset: lineStart,
          ...(match[2]
            ? {
                title:
                  match[2].trim(),
              }
            : {}),
        });
      } else if (
        match &&
        lineStart === 0 &&
        match[2]
      ) {
        boundaries[0] = {
          offset: 0,
          title:
            match[2].trim(),
        };
      }

      if (newline === -1) {
        break;
      }

      lineStart = newline + 1;
    }

    const spans:
      RawChunkSpan[] =
      boundaries.map(
        (boundary, index) => ({
          startOffset:
            boundary.offset,
          endOffset:
            boundaries[index + 1]
              ?.offset ??
            context.content
              .length,
          kind:
            "markdown_section",
          ...(boundary.title
            ? {
                title:
                  boundary.title,
              }
            : {}),
        }),
      );

    return {
      spans,
      warnings: [],
    };
  }

  private extensionOf(
    relativePath: string,
  ): string {
    const basename =
      relativePath
        .replace(/\\/g, "/")
        .toLowerCase()
        .split("/")
        .pop() ??
      relativePath;

    const dot =
      basename.lastIndexOf(".");

    return dot >= 0
      ? basename.slice(dot)
      : "";
  }
}

