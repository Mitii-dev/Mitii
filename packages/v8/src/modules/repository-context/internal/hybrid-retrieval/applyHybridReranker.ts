import { HYBRID_RETRIEVAL_MESSAGES } from "./constants";
import {
  clampUnit,
  sortHybridCandidates,
} from "./hybridRetrievalResultBuilders";
import { retrievalRerankerResultSchema } from "./schema";

import type {
  HybridRetrievalCandidate,
  HybridRetrievalWarning,
  ResolvedHybridRetrieverOptions,
  RetrievalReranker,
  RetrievalRerankerResult,
} from "./types";

type RerankerOptions = Pick<
  ResolvedHybridRetrieverOptions,
  "rerankerCandidatePool" | "rerankerWeight" | "rerankerFailureMode"
>;

/**
 * Applies the configured reranker to the candidate pool.
 * Returns `null` only when the reranker fails and the failure mode is `fail`.
 */
export async function applyHybridReranker(
  reranker: RetrievalReranker | undefined,
  options: RerankerOptions,
  query: string,
  candidates: HybridRetrievalCandidate[],
  maximumResults: number,
  abortSignal: AbortSignal | undefined,
  warnings: HybridRetrievalWarning[],
): Promise<HybridRetrievalCandidate[] | null> {
  if (!reranker) {
    return candidates;
  }

  try {
    const pool = candidates.slice(0, options.rerankerCandidatePool);

    const rawResult = await reranker.rerank({
      query,
      candidates: pool,
      maximumResults,
      ...(abortSignal ? { abortSignal } : {}),
    });

    const result = retrievalRerankerResultSchema.parse(
      rawResult,
    ) as RetrievalRerankerResult;

    const candidateKeys = new Set(pool.map((candidate) => candidate.key));

    for (const rerankScore of result.scores) {
      if (!candidateKeys.has(rerankScore.key)) {
        throw new Error(
          `Reranker returned unknown candidate key "${rerankScore.key}".`,
        );
      }
    }

    const scoreByKey = new Map(
      result.scores.map((score) => [score.key, score]),
    );

    if (scoreByKey.size < pool.length) {
      warnings.push({
        code: "reranker_incomplete",
        message: HYBRID_RETRIEVAL_MESSAGES.RERANKER_INCOMPLETE,
      });
    }

    const reranked = candidates.map((candidate) => {
      const rerankScore = scoreByKey.get(candidate.key);

      if (!rerankScore) {
        return candidate;
      }

      return {
        ...candidate,
        rerankerScore: rerankScore.score,
        score: clampUnit(
          candidate.fusedScore * (1 - options.rerankerWeight) +
            rerankScore.score * options.rerankerWeight,
        ),
        reasons: [
          ...candidate.reasons,
          {
            type: "reranked" as const,
            evidence:
              rerankScore.reason ?? `Reranked by ${reranker.id ?? "reranker"}.`,
          },
        ],
      };
    });

    sortHybridCandidates(reranked);

    return reranked;
  } catch (_error) {
    if (options.rerankerFailureMode === "fail") {
      warnings.push({
        code: "reranker_failed",
        message: HYBRID_RETRIEVAL_MESSAGES.RERANKER_REQUIRED_FAILED,
      });

      return null;
    }

    warnings.push({
      code: "reranker_failed",
      message: HYBRID_RETRIEVAL_MESSAGES.RERANKER_FAILED,
    });

    return candidates;
  }
}
