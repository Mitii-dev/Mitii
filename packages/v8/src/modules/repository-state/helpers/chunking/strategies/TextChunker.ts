import {
  CHUNKING_IDS,
  CHUNKING_STRATEGY_PRIORITIES,
} from "../constants";

import type {
  ChunkingStrategy,
  ChunkingStrategyContext,
  ChunkingStrategyResult,
} from "../types";

export class TextChunker
  implements ChunkingStrategy
{
  public readonly id =
    CHUNKING_IDS.TEXT_STRATEGY;

  public readonly priority =
    CHUNKING_STRATEGY_PRIORITIES
      .TEXT;

  public supports(
    _context: ChunkingStrategyContext,
  ): boolean {
    return true;
  }

  public createSpans(
    context: ChunkingStrategyContext,
  ): ChunkingStrategyResult {
    return {
      spans:
        context.content.length > 0
          ? [
              {
                startOffset: 0,
                endOffset:
                  context.content
                    .length,
                kind: "text",
              },
            ]
          : [],
      warnings: [],
    };
  }
}

