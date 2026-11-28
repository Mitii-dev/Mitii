import {
  splitCodeIdentifier,
} from "../../../repository-state";

import type {
  HybridRetrievalCandidate,
  RetrievalRerankScore,
  RetrievalReranker,
  RetrievalRerankerInput,
  RetrievalRerankerResult,
} from "./types";

/**
 * Cheap lexical reranker: identifier overlap + path/title boost after RRF.
 * No model or network dependency.
 */
export class IdentifierAwareRetrievalReranker implements RetrievalReranker {
  public readonly id = "identifier-aware-reranker";

  public async rerank(
    input: RetrievalRerankerInput,
  ): Promise<RetrievalRerankerResult> {
    const queryTerms = tokenize(input.query);
    const scores: RetrievalRerankScore[] = input.candidates.map(
      (candidate) => ({
        key: candidate.key,
        score: scoreCandidate(candidate, queryTerms),
        reason: "identifier-aware lexical overlap",
      }),
    );
    return { scores };
  }
}

function tokenize(value: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of value.split(/[^\p{L}\p{N}_$]+/u)) {
    const token = raw.trim();
    if (!token) continue;
    for (const part of splitCodeIdentifier(token)) {
      terms.add(part);
    }
  }
  return terms;
}

function scoreCandidate(
  candidate: HybridRetrievalCandidate,
  queryTerms: Set<string>,
): number {
  if (queryTerms.size === 0) {
    return candidate.score;
  }
  const haystack = tokenize(
    [
      candidate.title ?? "",
      candidate.preview ?? "",
      candidate.relativePath,
      candidate.symbolId ?? "",
    ].join(" "),
  );
  let overlap = 0;
  for (const term of queryTerms) {
    if (haystack.has(term)) overlap += 1;
  }
  const overlapScore = overlap / queryTerms.size;
  const pathBoost = [...queryTerms].some((term) =>
    candidate.relativePath.toLowerCase().includes(term),
  )
    ? 0.15
    : 0;
  return Math.min(1, overlapScore * 0.85 + pathBoost);
}
