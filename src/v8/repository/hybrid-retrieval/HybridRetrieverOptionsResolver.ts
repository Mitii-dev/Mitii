import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_LIMITS,
} from "./constants";

import type {
  HybridRetrieverOptions,
  ResolvedHybridRetrieverOptions,
} from "./types";

export class HybridRetrieverOptionsResolver {
  public resolve(
    options:
      HybridRetrieverOptions = {},
  ): ResolvedHybridRetrieverOptions {
    const resolved:
      ResolvedHybridRetrieverOptions = {
        maximumResults:
          options.maximumResults ??
          HYBRID_RETRIEVAL_DEFAULTS
            .MAXIMUM_RESULTS,
        maximumCandidatesPerSource:
          options
            .maximumCandidatesPerSource ??
          HYBRID_RETRIEVAL_DEFAULTS
            .MAXIMUM_CANDIDATES_PER_SOURCE,
        rankConstant:
          options.rankConstant ??
          HYBRID_RETRIEVAL_DEFAULTS
            .RANK_CONSTANT,
        failureMode:
          options.failureMode ??
          HYBRID_RETRIEVAL_DEFAULTS
            .FAILURE_MODE,
        minimumSuccessfulSources:
          options
            .minimumSuccessfulSources ??
          HYBRID_RETRIEVAL_DEFAULTS
            .MINIMUM_SUCCESSFUL_SOURCES,
        rerankerCandidatePool:
          options
            .rerankerCandidatePool ??
          HYBRID_RETRIEVAL_DEFAULTS
            .RERANKER_CANDIDATE_POOL,
        rerankerWeight:
          options.rerankerWeight ??
          HYBRID_RETRIEVAL_DEFAULTS
            .RERANKER_WEIGHT,
        rerankerFailureMode:
          options
            .rerankerFailureMode ??
          HYBRID_RETRIEVAL_DEFAULTS
            .RERANKER_FAILURE_MODE,
      };

    this.positiveInteger(
      "maximumResults",
      resolved.maximumResults,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_RESULTS,
    );

    this.positiveInteger(
      "maximumCandidatesPerSource",
      resolved
        .maximumCandidatesPerSource,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_CANDIDATES_PER_SOURCE,
    );

    this.positiveInteger(
      "rankConstant",
      resolved.rankConstant,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_RANK_CONSTANT,
    );

    this.positiveInteger(
      "minimumSuccessfulSources",
      resolved
        .minimumSuccessfulSources,
      Number.MAX_SAFE_INTEGER,
    );

    this.positiveInteger(
      "rerankerCandidatePool",
      resolved
        .rerankerCandidatePool,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_RERANKER_CANDIDATE_POOL,
    );

    if (
      !Number.isFinite(
        resolved.rerankerWeight,
      ) ||
      resolved.rerankerWeight <
        0 ||
      resolved.rerankerWeight >
        1
    ) {
      throw new RangeError(
        "rerankerWeight must be between zero and one.",
      );
    }

    return resolved;
  }

  private positiveInteger(
    name: string,
    value: number,
    maximum: number,
  ): void {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value <= 0 ||
      value > maximum
    ) {
      throw new RangeError(
        `${name} must be a positive safe integer no greater than ${maximum}.`,
      );
    }
  }
}
