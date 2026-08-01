import {
  CONTEXT_ASSEMBLY_DEFAULTS,
  CONTEXT_ASSEMBLY_IDS,
  CONTEXT_ASSEMBLY_TRUNCATION_MARKERS,
  CONTEXT_ASSEMBLY_TRUNCATION_STRATEGIES,
} from "./constants";

import type {
  ChunkTokenEstimator,
} from "../../../repository-state/index";

import type {
  ContextLineRange,
  ContextTextTruncationInput,
  ContextTextTruncationResult,
} from "./types";

export class ContextTextTruncator {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .TEXT_TRUNCATOR;

  public constructor(
    private readonly tokenEstimator:
      ChunkTokenEstimator,
  ) {}

  public truncate(
    input:
      ContextTextTruncationInput,
  ): ContextTextTruncationResult {
    const currentTokens =
      this.tokenEstimator
        .estimate(
          input.content,
        );

    if (
      currentTokens <=
      input.maximumTokens
    ) {
      return {
        content:
          input.content,
        tokenEstimate:
          currentTokens,
        truncated:
          false,
        omittedCharacters:
          0,
        lineRanges:
          this.completeLineRanges(
            input,
          ),
      };
    }

    const strategy =
      CONTEXT_ASSEMBLY_TRUNCATION_STRATEGIES[
        input
          .representation
      ];
    const totalCharacters =
      input.content.length;
    let low =
      CONTEXT_ASSEMBLY_DEFAULTS
        .MINIMUM_TRUNCATED_CONTENT_CHARACTERS;
    let high =
      totalCharacters;
    let best:
      {
        content: string;
        retainedHead: number;
        retainedTail: number;
        tokenEstimate: number;
      } |
      undefined;

    for (
      let iteration = 0;
      iteration <
      CONTEXT_ASSEMBLY_DEFAULTS
        .TRUNCATION_BINARY_SEARCH_ITERATIONS;
      iteration += 1
    ) {
      if (low > high) {
        break;
      }

      const retainedCharacters =
        Math.floor(
          (
            low +
            high
          ) /
            2,
        );
      const candidate =
        this.buildCandidate(
          input.content,
          retainedCharacters,
          strategy,
        );
      const tokenEstimate =
        this.tokenEstimator
          .estimate(
            candidate
              .content,
          );

      if (
        tokenEstimate <=
        input.maximumTokens
      ) {
        best = {
          ...candidate,
          tokenEstimate,
        };
        low =
          retainedCharacters +
          1;
      } else {
        high =
          retainedCharacters -
          1;
      }
    }

    if (!best) {
      best =
        this.fitHeadWithoutMarker(
          input.content,
          input.maximumTokens,
        );
    }

    const omittedCharacters =
      Math.max(
        0,
        totalCharacters -
          best.retainedHead -
          best.retainedTail,
      );

    return {
      content:
        best.content,
      tokenEstimate:
        best.tokenEstimate,
      truncated:
        true,
      omittedCharacters,
      lineRanges:
        this.truncatedLineRanges(
          input,
          best.retainedHead,
          best.retainedTail,
        ),
    };
  }

  private buildCandidate(
    content: string,
    retainedCharacters: number,
    strategy:
      "head" |
      "head_tail",
  ): {
    content: string;
    retainedHead: number;
    retainedTail: number;
  } {
    if (
      strategy ===
      "head"
    ) {
      const head =
        content
          .slice(
            0,
            retainedCharacters,
          )
          .trimEnd();

      return {
        content:
          `${head}${CONTEXT_ASSEMBLY_TRUNCATION_MARKERS.HEAD}`,
        retainedHead:
          head.length,
        retainedTail:
          0,
      };
    }

    const headCharacters =
      Math.floor(
        retainedCharacters *
          CONTEXT_ASSEMBLY_DEFAULTS
            .HEAD_TAIL_HEAD_RATIO,
      );
    const tailCharacters =
      Math.max(
        0,
        retainedCharacters -
          headCharacters,
      );
    const head =
      content
        .slice(
          0,
          headCharacters,
        )
        .trimEnd();
    const tail =
      content
        .slice(
          -tailCharacters,
        )
        .trimStart();

    return {
      content:
        `${head}${CONTEXT_ASSEMBLY_TRUNCATION_MARKERS.HEAD_TAIL}${tail}`,
      retainedHead:
        head.length,
      retainedTail:
        tail.length,
    };
  }

  private fitHeadWithoutMarker(
    content: string,
    maximumTokens: number,
  ): {
    content: string;
    retainedHead: number;
    retainedTail: number;
    tokenEstimate: number;
  } {
    let low = 1;
    let high =
      content.length;
    let bestContent =
      content.slice(
        0,
        1,
      );
    let bestTokens =
      this.tokenEstimator
        .estimate(
          bestContent,
        );

    while (
      low <= high
    ) {
      const length =
        Math.floor(
          (
            low +
            high
          ) /
            2,
        );
      const candidate =
        content.slice(
          0,
          length,
        );
      const tokenEstimate =
        this.tokenEstimator
          .estimate(
            candidate,
          );

      if (
        tokenEstimate <=
        maximumTokens
      ) {
        bestContent =
          candidate;
        bestTokens =
          tokenEstimate;
        low =
          length +
          1;
      } else {
        high =
          length -
          1;
      }
    }

    return {
      content:
        bestContent,
      retainedHead:
        bestContent.length,
      retainedTail:
        0,
      tokenEstimate:
        bestTokens,
    };
  }

  private completeLineRanges(
    input:
      ContextTextTruncationInput,
  ): ContextLineRange[] {
    const startLine =
      input.startLine ??
      1;
    const endLine =
      input.endLine ??
      (
        startLine +
        this.countNewlines(
          input.content,
        )
      );

    return [
      {
        startLine,
        endLine:
          Math.max(
            startLine,
            endLine,
          ),
      },
    ];
  }

  private truncatedLineRanges(
    input:
      ContextTextTruncationInput,
    retainedHead: number,
    retainedTail: number,
  ): ContextLineRange[] {
    const sourceStart =
      input.startLine ??
      1;
    const sourceEnd =
      input.endLine ??
      (
        sourceStart +
        this.countNewlines(
          input.content,
        )
      );
    const ranges:
      ContextLineRange[] = [];

    if (
      retainedHead > 0
    ) {
      ranges.push({
        startLine:
          sourceStart,
        endLine:
          Math.min(
            sourceEnd,
            sourceStart +
              this.countNewlines(
                input.content
                  .slice(
                    0,
                    retainedHead,
                  ),
              ),
          ),
      });
    }

    if (
      retainedTail > 0
    ) {
      const tail =
        input.content.slice(
          -retainedTail,
        );
      const tailStart =
        Math.max(
          sourceStart,
          sourceEnd -
            this.countNewlines(
              tail,
            ),
        );

      if (
        ranges.length ===
          0 ||
        tailStart >
          ranges[0]!
            .endLine
      ) {
        ranges.push({
          startLine:
            tailStart,
          endLine:
            sourceEnd,
        });
      }
    }

    return ranges;
  }

  private countNewlines(
    content: string,
  ): number {
    return (
      content.match(
        /\n/g,
      ) ??
      []
    ).length;
  }
}
