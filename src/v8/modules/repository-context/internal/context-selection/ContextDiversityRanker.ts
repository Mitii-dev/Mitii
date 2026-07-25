import {
  CONTEXT_SELECTION_DIVERSITY_WEIGHTS,
  CONTEXT_SELECTION_IDS,
  CONTEXT_SELECTION_PATH_SIMILARITY,
  CONTEXT_SELECTION_PRIORITY_ORDER,
} from "./constants";

import type {
  ContextDiversityRankingInput,
  ContextDiversityRankingResult,
  ScoredContextCandidate,
} from "./types";

export class ContextDiversityRanker {
  public readonly id =
    CONTEXT_SELECTION_IDS
      .DIVERSITY_RANKER;

  public rank(
    input:
      ContextDiversityRankingInput,
  ): ContextDiversityRankingResult {
    const required =
      input.candidates
        .filter(
          (candidate) =>
            candidate.candidate
              .priority ===
            "required",
        )
        .map(
          (candidate) =>
            this.clone(
              candidate,
            ),
        )
        .sort(
          (left, right) =>
            right.score -
              left.score ||
            left.candidate.key
              .localeCompare(
                right.candidate
                  .key,
              ),
        );

    const remaining =
      input.candidates
        .filter(
          (candidate) =>
            candidate.candidate
              .priority !==
            "required",
        )
        .map(
          (candidate) =>
            this.clone(
              candidate,
            ),
        );
    const ranked = [
      ...required,
    ];
    const diversityWeight =
      CONTEXT_SELECTION_DIVERSITY_WEIGHTS[
        input.mode
      ][input.breadth];

    while (
      remaining.length > 0
    ) {
      if (
        input.abortSignal
          ?.aborted
      ) {
        return {
          candidates:
            ranked,
          cancelled:
            true,
        };
      }

      const scored =
        remaining.map(
          (
            candidate,
            index,
          ) => {
            const similarity =
              ranked.length ===
                0
                ? 0
                : Math.max(
                    ...ranked.map(
                      (selected) =>
                        this.similarity(
                          candidate,
                          selected,
                        ),
                    ),
                  );
            const penalty =
              similarity *
              diversityWeight;
            const utility =
              candidate.score *
                (
                  1 -
                  diversityWeight
                ) -
              penalty;

            return {
              index,
              candidate,
              similarity,
              penalty,
              utility,
            };
          },
        )
          .sort(
            (left, right) =>
              right.utility -
                left.utility ||
              CONTEXT_SELECTION_PRIORITY_ORDER[
                left.candidate
                  .candidate
                  .priority
              ] -
                CONTEXT_SELECTION_PRIORITY_ORDER[
                  right.candidate
                    .candidate
                    .priority
                ] ||
              right.candidate
                .score -
                left.candidate
                  .score ||
              left.candidate
                .candidate.key
                .localeCompare(
                  right.candidate
                    .candidate.key,
                ),
          )[0];

      if (!scored) {
        break;
      }

      const [
        selected,
      ] = remaining.splice(
        scored.index,
        1,
      );

      if (!selected) {
        break;
      }

      selected.utilityScore =
        scored.utility;

      if (
        scored.penalty > 0
      ) {
        selected.signals.push({
          type:
            "diversity_penalty",
          score:
            -scored.penalty,
          evidence:
            `Redundancy penalty ${scored.penalty.toFixed(3)} from similarity with already ranked context.`,
        });
      }

      ranked.push(
        selected,
      );
    }

    return {
      candidates:
        ranked,
      cancelled:
        false,
    };
  }

  private similarity(
    left:
      ScoredContextCandidate,
    right:
      ScoredContextCandidate,
  ): number {
    const leftCandidate =
      left.candidate;
    const rightCandidate =
      right.candidate;

    if (
      leftCandidate.key ===
      rightCandidate.key
    ) {
      return CONTEXT_SELECTION_PATH_SIMILARITY
        .IDENTICAL_CANDIDATE;
    }

    const sameRoot =
      (
        leftCandidate
          .rootId ??
        ""
      ) ===
      (
        rightCandidate
          .rootId ??
        ""
      );

    if (
      sameRoot &&
      leftCandidate
        .relativePath ===
        rightCandidate
          .relativePath
    ) {
      return CONTEXT_SELECTION_PATH_SIMILARITY
        .SAME_FILE;
    }

    const leftSegments =
      leftCandidate
        .relativePath
        .toLowerCase()
        .split("/");
    const rightSegments =
      rightCandidate
        .relativePath
        .toLowerCase()
        .split("/");
    const leftDirectory =
      leftSegments
        .slice(
          0,
          -1,
        )
        .join("/");
    const rightDirectory =
      rightSegments
        .slice(
          0,
          -1,
        )
        .join("/");

    if (
      sameRoot &&
      leftDirectory &&
      leftDirectory ===
        rightDirectory
    ) {
      return CONTEXT_SELECTION_PATH_SIMILARITY
        .SAME_DIRECTORY;
    }

    const leftSet =
      new Set(
        leftSegments,
      );
    const rightSet =
      new Set(
        rightSegments,
      );
    const intersection =
      [
        ...leftSet,
      ].filter(
        (segment) =>
          rightSet.has(
            segment,
          ),
      ).length;
    const union =
      new Set([
        ...leftSet,
        ...rightSet,
      ]).size;

    return union > 0
      ? (
          intersection /
          union
        ) *
          CONTEXT_SELECTION_PATH_SIMILARITY
            .SHARED_SEGMENT_SCALE
      : 0;
  }

  private clone(
    candidate:
      ScoredContextCandidate,
  ): ScoredContextCandidate {
    return {
      ...candidate,
      candidate: {
        ...candidate.candidate,
        origins: [
          ...candidate
            .candidate.origins,
        ],
      },
      signals:
        candidate.signals.map(
          (signal) => ({
            ...signal,
          }),
        ),
      representationOptions:
        candidate
          .representationOptions
          .map(
            (option) => ({
              ...option,
            }),
          ),
    };
  }
}
