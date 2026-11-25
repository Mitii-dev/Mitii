import { describe, expect, it } from "vitest";

import { computePageRank } from "./pageRank";
import {
  importanceByRelativePathFromRepoMap,
  toImportanceScores,
} from "./importance";

describe("computePageRank", () => {
  it("returns empty map for no nodes", () => {
    expect(computePageRank([], [])).toEqual(new Map());
  });

  it("gives equal mass to disconnected nodes", () => {
    const scores = computePageRank(["a", "b", "c"], [], {
      iterations: 20,
      damping: 0.85,
    });
    expect(scores.size).toBe(3);
    const values = [...scores.values()];
    expect(values[0]).toBeCloseTo(values[1]!, 5);
    expect(values[1]).toBeCloseTo(values[2]!, 5);
    const sum = values.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("ranks nodes with inbound edges higher", () => {
    const scores = computePageRank(
      ["hub", "leaf", "other"],
      [
        { from: "leaf", to: "hub", weight: 1 },
        { from: "other", to: "hub", weight: 1 },
      ],
      { iterations: 40, damping: 0.85 },
    );
    expect(scores.get("hub")!).toBeGreaterThan(scores.get("leaf")!);
    expect(scores.get("hub")!).toBeGreaterThan(scores.get("other")!);
  });

  it("respects personalization toward a preferred node", () => {
    const personalization = new Map([
      ["a", 10],
      ["b", 1],
      ["c", 1],
    ]);
    const scores = computePageRank(
      ["a", "b", "c"],
      [],
      { iterations: 30, damping: 0.85, personalization },
    );
    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!);
  });

  it("ignores self-loops and unknown endpoints", () => {
    const scores = computePageRank(
      ["a", "b"],
      [
        { from: "a", to: "a", weight: 99 },
        { from: "a", to: "missing", weight: 5 },
        { from: "a", to: "b", weight: 1 },
      ],
      { iterations: 30 },
    );
    expect(scores.get("b")!).toBeGreaterThan(0);
    expect(scores.has("missing")).toBe(false);
  });
});

describe("importance helpers", () => {
  it("toImportanceScores sorts by descending score", () => {
    const rows = toImportanceScores(
      new Map([
        ["f1", 0.1],
        ["f2", 0.5],
        ["f3", 0.2],
      ]),
      {
        relativePathByEntityId: new Map([["f2", "src/core.ts"]]),
      },
    );
    expect(rows.map((r) => r.entityId)).toEqual(["f2", "f3", "f1"]);
    expect(rows[0]?.relativePath).toBe("src/core.ts");
    expect(rows[0]?.source).toBe("page_rank");
  });

  it("importanceByRelativePathFromRepoMap prefers higher composite score", () => {
    const map = importanceByRelativePathFromRepoMap([
      {
        file: { relativePath: "a.ts" },
        pageRank: 0.1,
        score: 2,
      },
      {
        file: { relativePath: "a.ts" },
        pageRank: 0.9,
        score: 5,
      },
      {
        file: { relativePath: "b.ts" },
        pageRank: 0.2,
        score: 1,
      },
    ]);
    expect(map.get("a.ts")).toBe(5);
    expect(map.get("b.ts")).toBe(1);
  });
});
