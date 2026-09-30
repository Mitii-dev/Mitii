import { describe, expect, it } from "vitest";

import {
  classifyImpactBucket,
  compactChangeImpactForModelFacing,
  isChangeImpactToolOutput,
  CHANGE_IMPACT_POLICY,
} from "../index";

describe("classifyImpactBucket", () => {
  it("marks common test path conventions as test", () => {
    expect(classifyImpactBucket("src/LoginForm.test.tsx")).toBe("test");
    expect(classifyImpactBucket("tests/unit/foo.ts")).toBe("test");
    expect(classifyImpactBucket("pkg/__tests__/bar.ts")).toBe("test");
    expect(classifyImpactBucket("src/LoginForm.tsx")).toBe("prod");
  });
});

describe("compactChangeImpactForModelFacing", () => {
  it("prefers hop/score order and caps nodes, evidence, and files", () => {
    const affected = Array.from({ length: 30 }, (_, index) => ({
      path: `src/n${index}.ts`,
      hop: index < 5 ? 1 : 2,
      viaEdgeType: "imports",
      score: 1 - index * 0.01,
      evidence: ["a", "b", "c", "d"],
    }));
    const affectedFiles = Array.from({ length: 60 }, (_, index) => ({
      path: `src/f${index}.ts`,
      hop: index < 10 ? 1 : 2,
      score: 1 - index * 0.01,
      affectedNodeCount: 1,
      reason: "dependent",
    }));

    const slim = compactChangeImpactForModelFacing({
      affected,
      affectedFiles,
      packagesAffected: [],
    });

    expect(slim.affected).toHaveLength(
      CHANGE_IMPACT_POLICY.modelFacingAffectedNodes,
    );
    expect(slim.affectedFiles).toHaveLength(
      CHANGE_IMPACT_POLICY.modelFacingAffectedFiles,
    );
    expect(slim.affected[0]?.evidence).toHaveLength(
      CHANGE_IMPACT_POLICY.modelFacingEvidencePerNode,
    );
    expect(slim.affected.slice(0, 5).every((node) => node.hop === 1)).toBe(
      true,
    );
    expect(slim.affected[5]?.hop).toBe(2);
    expect(slim.affectedFiles.slice(0, 10).every((file) => file.hop === 1)).toBe(
      true,
    );
    expect(slim.modelFacingTruncated).toBe(true);
    expect(slim.totalAffectedNodes).toBe(30);
    expect(slim.totalAffectedFiles).toBe(60);
  });

  it("ranks prod ahead of test at the same hop", () => {
    const slim = compactChangeImpactForModelFacing({
      affected: [],
      affectedFiles: [
        {
          path: "src/LoginForm.test.tsx",
          hop: 1,
          score: 0.99,
          affectedNodeCount: 1,
          reason: "test",
          bucket: "test",
        },
        {
          path: "src/App.tsx",
          hop: 1,
          score: 0.5,
          affectedNodeCount: 1,
          reason: "prod",
          bucket: "prod",
        },
      ],
      packagesAffected: [],
    });

    expect(slim.affectedFiles.map((file) => file.path)).toEqual([
      "src/App.tsx",
      "src/LoginForm.test.tsx",
    ]);
    expect(slim.affectedFiles[0]?.bucket).toBe("prod");
  });

  it("prefix-collapses chains for model-facing output", () => {
    const slim = compactChangeImpactForModelFacing({
      affected: [],
      affectedFiles: [],
      packagesAffected: [],
      chains: [
        {
          hop: 2,
          score: 1,
          links: [
            { path: "src/core.ts", symbolName: "seed" },
            { path: "src/caller.ts", symbolName: "mid" },
            { path: "src/a.ts", symbolName: "a" },
          ],
        },
        {
          hop: 2,
          score: 0.9,
          links: [
            { path: "src/core.ts", symbolName: "seed" },
            { path: "src/caller.ts", symbolName: "mid" },
            { path: "src/b.ts", symbolName: "b" },
          ],
        },
      ],
    });

    expect(slim.chains[0]).toBe("src/core.ts:seed → src/caller.ts:mid");
    expect(slim.chains).toContain("  → src/a.ts:a");
    expect(slim.chains).toContain("  → src/b.ts:b");
    expect(slim.totalChains).toBe(2);
  });

  it("detects change-impact shaped tool output", () => {
    expect(
      isChangeImpactToolOutput({
        provider: "repo_graph",
        status: "complete",
        affected: [],
        affectedFiles: [{ path: "a.ts", hop: 1, score: 1, affectedNodeCount: 1, reason: "x" }],
      }),
    ).toBe(true);
    expect(isChangeImpactToolOutput({ content: "hello" })).toBe(false);
  });
});
