import {
  CONTEXT_SELECTION_DEFAULTS,
  CONTEXT_SELECTION_IDS,
  CONTEXT_SELECTION_MODE_MULTIPLIERS,
  CONTEXT_SELECTION_SIGNAL_BOOSTS,
} from "./constants";

import {
  ContextPathMatcher,
} from "./ContextPathMatcher";

import {
  ContextRepresentationPolicy,
} from "./ContextRepresentationPolicy";

import type {
  ContextCandidateOrigin,
  ContextScoringInput,
  ContextSelectionScoreSignal,
  ContextSelectionScoreSignalType,
  ScoredContextCandidate,
} from "./types";

export class ContextSelectionScorer {
  public readonly id =
    CONTEXT_SELECTION_IDS
      .SCORER;

  public constructor(
    private readonly pathMatcher =
      new ContextPathMatcher(),
    private readonly representationPolicy =
      new ContextRepresentationPolicy(),
  ) {}

  public score(
    input:
      ContextScoringInput,
  ): ScoredContextCandidate {
    const {
      candidate,
      request,
    } = input;
    const retrievalScore =
      candidate
        .retrievalCandidate
        ?.score ??
      CONTEXT_SELECTION_DEFAULTS
        .UNKNOWN_RETRIEVAL_SCORE;
    const signals:
      ContextSelectionScoreSignal[] =
      [
        {
          type:
            "retrieval_score",
          score:
            retrievalScore,
          evidence:
            candidate
              .retrievalCandidate
              ? "Base score from hybrid retrieval."
              : "Default base score for a direct context reference.",
        },
      ];

    let score =
      retrievalScore;

    const sourceCount =
      candidate
        .retrievalCandidate
        ?.matchedSourceCount ??
      0;

    if (
      sourceCount >
      CONTEXT_SELECTION_DEFAULTS
        .MULTI_SOURCE_BASE_COUNT
    ) {
      const bonusCount =
        Math.min(
          sourceCount,
          CONTEXT_SELECTION_DEFAULTS
            .MAXIMUM_MULTI_SOURCE_BONUS_COUNT,
        ) -
        CONTEXT_SELECTION_DEFAULTS
          .MULTI_SOURCE_BASE_COUNT;
      const boost =
        CONTEXT_SELECTION_SIGNAL_BOOSTS
          .multi_source_agreement *
        bonusCount;

      score =
        this.applyBoost(
          score,
          boost,
        );
      signals.push({
        type:
          "multi_source_agreement",
        score:
          boost,
        evidence:
          `${sourceCount} retrieval sources agreed on this candidate.`,
      });
    }

    if (
      this.pathMatcher
        .isQueryMatch(
          request.query,
          candidate
            .relativePath,
        )
    ) {
      const boost =
        CONTEXT_SELECTION_SIGNAL_BOOSTS
          .query_path_match;

      score =
        this.applyBoost(
          score,
          boost,
        );
      signals.push({
        type:
          "query_path_match",
        score:
          boost,
        evidence:
          "The query directly mentions the candidate path, filename, or stem.",
      });
    }

    for (
      const origin of
        candidate.origins
    ) {
      if (
        origin ===
        "retrieval"
      ) {
        continue;
      }

      const type =
        this.originSignal(
          origin,
        );
      const baseBoost =
        CONTEXT_SELECTION_SIGNAL_BOOSTS[
          type
        ];
      const multiplier =
        CONTEXT_SELECTION_MODE_MULTIPLIERS[
          request.mode
        ][origin] ??
        1;
      const boost =
        Math.min(
          1,
          baseBoost *
            multiplier,
        );

      score =
        this.applyBoost(
          score,
          boost,
        );
      signals.push({
        type,
        score:
          boost,
        evidence:
          this.originEvidence(
            origin,
            request.mode,
          ),
      });
    }

    if (
      candidate.priority ===
      "required"
    ) {
      score =
        CONTEXT_SELECTION_DEFAULTS
          .REQUIRED_SCORE;
      signals.push({
        type:
          "required_priority",
        score:
          CONTEXT_SELECTION_SIGNAL_BOOSTS
            .required_priority,
        evidence:
          "The user or editor context marked this reference as required.",
      });
    }

    const representationPlan =
      this.representationPolicy
        .plan(
          candidate,
          request.mode,
        );

    return {
      candidate,
      score:
        this.clamp(
          score,
        ),
      utilityScore:
        this.clamp(
          score,
        ),
      signals,
      representationOptions:
        representationPlan
          .options,
      usedDefaultEstimate:
        representationPlan
          .usedDefaultEstimate,
    };
  }

  private originSignal(
    origin:
      Exclude<
        ContextCandidateOrigin,
        "retrieval"
      >,
  ): Exclude<
    ContextSelectionScoreSignalType,
    | "retrieval_score"
    | "multi_source_agreement"
    | "query_path_match"
    | "required_priority"
    | "diversity_penalty"
  > {
    return origin;
  }

  private originEvidence(
    origin:
      ContextCandidateOrigin,
    mode: string,
  ): string {
    return (
      `${origin.replace(/_/g, " ")} context is relevant in ${mode} mode.`
    );
  }

  private applyBoost(
    value: number,
    boost: number,
  ): number {
    return (
      value +
      (
        1 -
        value
      ) *
        this.clamp(
          boost,
        )
    );
  }

  private clamp(
    value: number,
  ): number {
    return Math.max(
      0,
      Math.min(1, value),
    );
  }
}
