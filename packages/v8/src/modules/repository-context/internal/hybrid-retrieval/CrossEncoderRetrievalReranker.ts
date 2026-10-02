import type {
  HybridRetrievalCandidate,
  RetrievalRerankScore,
  RetrievalReranker,
  RetrievalRerankerInput,
  RetrievalRerankerResult,
} from "./types";

/**
 * Host-provided pair scorer (Continue-style cross-encoder / Voyage / Cohere).
 * Documents are already flattened text; Mitii does not vendor a model.
 */
export interface CrossEncoderDocumentScorer {
  readonly id: string;

  score(input: {
    query: string;
    documents: readonly string[];
    abortSignal?: AbortSignal;
  }): Promise<readonly number[]>;
}

export type CrossEncoderDocumentFormatter = (
  candidate: HybridRetrievalCandidate,
) => string;

const defaultFormatter: CrossEncoderDocumentFormatter = (candidate) => {
  const parts = [
    candidate.relativePath,
    candidate.title,
    candidate.preview,
    candidate.symbolId,
  ].filter((value): value is string => Boolean(value && value.trim()));
  return parts.join("\n");
};

/**
 * Optional post-RRF cross-encoder rerank via a pluggable scorer port.
 * Gate by cost at the host: only register when a scorer is configured.
 */
export class CrossEncoderRetrievalReranker
  implements RetrievalReranker
{
  public readonly id: string;

  constructor(
    private readonly scorer: CrossEncoderDocumentScorer,
    private readonly formatDocument:
      CrossEncoderDocumentFormatter = defaultFormatter,
  ) {
    this.id = `cross-encoder:${scorer.id}`;
  }

  public async rerank(
    input: RetrievalRerankerInput,
  ): Promise<RetrievalRerankerResult> {
    if (input.candidates.length === 0) {
      return { scores: [] };
    }

    const documents = input.candidates.map((candidate) =>
      this.formatDocument(candidate),
    );

    const rawScores = await this.scorer.score({
      query: input.query,
      documents,
      ...(input.abortSignal
        ? { abortSignal: input.abortSignal }
        : {}),
    });

    if (rawScores.length !== input.candidates.length) {
      throw new Error(
        `Cross-encoder scorer "${this.scorer.id}" returned ${rawScores.length} scores for ${input.candidates.length} candidates.`,
      );
    }

    const scores: RetrievalRerankScore[] = input.candidates.map(
      (candidate, index) => ({
        key: candidate.key,
        score: normalizeScore(rawScores[index]!),
        reason: `cross-encoder:${this.scorer.id}`,
      }),
    );

    return { scores };
  }
}

function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value >= 0 && value <= 1) {
    return value;
  }
  // Some APIs emit unbounded logits — squash to (0, 1).
  return 1 / (1 + Math.exp(-value));
}
