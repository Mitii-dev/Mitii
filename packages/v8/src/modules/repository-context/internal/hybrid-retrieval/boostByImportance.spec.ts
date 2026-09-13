import { describe, expect, it } from "vitest";

import { boostCandidatesByRepoMapImportance } from "./boostByImportance";

describe("boostCandidatesByRepoMapImportance", () => {
  it("boosts and reorders by repo-map importance", () => {
    const { candidates, boostedCount } = boostCandidatesByRepoMapImportance({
      candidates: [
        {
          relativePath: "low.ts",
          fusedScore: 0.5,
          score: 0.5,
          reasons: [],
        },
        {
          relativePath: "high.ts",
          fusedScore: 0.4,
          score: 0.4,
          reasons: [],
        },
      ],
      importanceByPath: new Map([
        ["high.ts", 10],
        ["low.ts", 1],
      ]),
      alpha: 0.5,
    });

    expect(boostedCount).toBe(2);
    expect(candidates[0]?.relativePath).toBe("high.ts");
    expect(candidates[0]!.fusedScore).toBeGreaterThan(candidates[1]!.fusedScore);
    expect(
      candidates[0]?.reasons.some((r) => r.type === "repo_map_importance_boost"),
    ).toBe(true);
  });

  it("is a no-op when importance map is empty", () => {
    const input = [
      {
        relativePath: "a.ts",
        fusedScore: 1,
        score: 1,
        reasons: [],
      },
    ];
    const { candidates, boostedCount } = boostCandidatesByRepoMapImportance({
      candidates: input,
      importanceByPath: new Map(),
    });
    expect(boostedCount).toBe(0);
    expect(candidates[0]?.fusedScore).toBe(1);
  });

  it("keeps boosted fused scores within the normalized schema range", () => {
    const { candidates } = boostCandidatesByRepoMapImportance({
      candidates: [
        {
          relativePath: "top.ts",
          fusedScore: 1,
          score: 1,
          reasons: [],
        },
      ],
      importanceByPath: new Map([["top.ts", 10]]),
      alpha: 1,
    });

    expect(candidates[0]?.fusedScore).toBe(1);
    expect(candidates[0]?.score).toBe(1);
  });
});
