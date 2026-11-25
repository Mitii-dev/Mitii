import { describe, expect, it } from "vitest";

import { IdentifierAwareRetrievalReranker } from "./IdentifierAwareRetrievalReranker";
import type { HybridRetrievalCandidate } from "./types";

function candidate(
  overrides: Partial<HybridRetrievalCandidate>,
): HybridRetrievalCandidate {
  return {
    key: "candidate",
    entityKind: "file",
    rootId: "workspace",
    relativePath: "src/util.ts",
    fusedScore: 0.2,
    score: 0.2,
    matchedSourceCount: 1,
    contributions: [],
    reasons: [],
    ...overrides,
  };
}

describe("IdentifierAwareRetrievalReranker", () => {
  it("boosts camelCase identifier overlap over unrelated paths", async () => {
    const reranker = new IdentifierAwareRetrievalReranker();
    const result = await reranker.rerank({
      query: "validateJwt",
      maximumResults: 5,
      candidates: [
        candidate({
          key: "hit",
          relativePath: "src/auth/jwt.ts",
          title: "validateJwt",
          preview: "export function validateJwt()",
        }),
        candidate({
          key: "miss",
          relativePath: "docs/readme.md",
          title: "overview",
        }),
      ],
    });

    const hit = result.scores.find((score) => score.key === "hit");
    const miss = result.scores.find((score) => score.key === "miss");
    expect(hit?.score ?? 0).toBeGreaterThan(miss?.score ?? 1);
  });
});
