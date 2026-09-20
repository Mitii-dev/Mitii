import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_POLICY,
  compactChangeImpactForModelFacing,
  isChangeImpactToolOutput,
} from "../index";

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
