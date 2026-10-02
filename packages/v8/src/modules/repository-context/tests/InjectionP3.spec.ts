import { describe, expect, it } from "vitest";

import { HybridRetriever } from "../internal/hybrid-retrieval/HybridRetriever";
import {
  CrossEncoderRetrievalReranker,
  type CrossEncoderDocumentScorer,
} from "../internal/hybrid-retrieval/CrossEncoderRetrievalReranker";
import type {
  HybridRetrievalCandidate,
  RetrievalSource,
  RetrievalSourceResult,
} from "../internal/hybrid-retrieval/types";

class StaticRetrievalSource implements RetrievalSource {
  constructor(
    public readonly id: string,
    private readonly result: RetrievalSourceResult,
  ) {}

  public canRetrieve(): boolean {
    return true;
  }

  public async retrieve(): Promise<RetrievalSourceResult> {
    return this.result;
  }
}

function candidate(
  relativePath: string,
  sourceScore: number,
  preview?: string,
) {
  return {
    entityKind: "chunk" as const,
    rootId: "root",
    relativePath,
    chunkId: relativePath,
    sourceScore,
    preview,
    reasons: [
      {
        type: "lexical_match" as const,
        evidence: `Matched ${relativePath}.`,
      },
    ],
  };
}

describe("repository-context P3 injection", () => {
  it("cross-encoder reranker reorders fused candidates by scorer scores", async () => {
    const scorer: CrossEncoderDocumentScorer = {
      id: "stub",
      async score({ documents }) {
        return documents.map((document) =>
          document.includes("LoginForm") ? 0.95 : 0.1,
        );
      },
    };

    const result = await new HybridRetriever(
      [
        {
          source: new StaticRetrievalSource("text", {
            status: "complete",
            candidates: [
              candidate("src/utils.ts", 0.99, "helper utilities"),
              candidate("src/LoginForm.ts", 0.5, "export class LoginForm"),
            ],
            truncated: false,
            warnings: [],
          }),
        },
      ],
      { rerankerCandidatePool: 8, rerankerWeight: 0.8 },
      new CrossEncoderRetrievalReranker(scorer),
    ).retrieve({
      workspace: "workspace",
      query: "LoginForm render",
    });

    expect(result.candidates[0]?.relativePath).toBe("src/LoginForm.ts");
    expect(result.candidates[0]?.reasons.some((reason) => reason.type === "reranked")).toBe(
      true,
    );
  });

  it("rejects scorer length mismatches", async () => {
    const scorer: CrossEncoderDocumentScorer = {
      id: "broken",
      async score() {
        return [1];
      },
    };

    const reranker = new CrossEncoderRetrievalReranker(scorer);
    const candidates: HybridRetrievalCandidate[] = [
      {
        key: "a",
        entityKind: "file",
        rootId: "root",
        relativePath: "a.ts",
        fusedScore: 1,
        score: 1,
        matchedSourceCount: 1,
        contributions: [],
        reasons: [],
      },
      {
        key: "b",
        entityKind: "file",
        rootId: "root",
        relativePath: "b.ts",
        fusedScore: 0.5,
        score: 0.5,
        matchedSourceCount: 1,
        contributions: [],
        reasons: [],
      },
    ];

    await expect(
      reranker.rerank({
        query: "x",
        candidates,
        maximumResults: 2,
      }),
    ).rejects.toThrow(/returned 1 scores for 2 candidates/);
  });
});
