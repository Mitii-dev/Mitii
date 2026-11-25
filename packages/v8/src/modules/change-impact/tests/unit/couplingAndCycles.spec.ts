import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  ChangeImpactPipeline,
  recommendWidenVerification,
} from "../../index";
import {
  createGraph,
  edge,
  fileNode,
} from "../fixtures/changeImpactGraphFixtures";

describe("change-impact historical coupling and cycles", () => {
  it("applies capped co-change boosts to structural dependents", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "packages/api/src/core.ts"),
        fileNode("file:a", "packages/api/src/a.ts"),
        fileNode("file:b", "packages/api/src/b.ts"),
      ],
      edges: [
        edge("e1", "imports", "file:a", "file:core", 2, 1),
        edge("e2", "imports", "file:b", "file:core", 2, 1),
      ],
    });

    const baseline = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "packages/api/src/core.ts" },
      repoGraph: graph,
      includePackages: false,
    });

    const withCoupling = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "packages/api/src/core.ts" },
      repoGraph: graph,
      includePackages: false,
      historicalCoupling: [
        { relativePath: "packages/api/src/a.ts", coChangeCount: 8 },
        { relativePath: "packages/api/src/b.ts", coChangeCount: 1 },
      ],
    });

    const aBase = baseline.affectedFiles.find(
      (file) => file.relativePath === "packages/api/src/a.ts",
    )!.score;
    const aBoosted = withCoupling.affectedFiles.find(
      (file) => file.relativePath === "packages/api/src/a.ts",
    )!.score;
    expect(aBoosted).toBeGreaterThan(aBase);
    expect(withCoupling.reasonCodes).toContain("historical_coupling_applied");
    expect(withCoupling.affectedFiles[0]?.relativePath).toBe(
      "packages/api/src/a.ts",
    );
  });

  it("adds evidence-gated hidden coupling for same-package co-changers", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "packages/api/src/session.ts"),
        fileNode("file:caller", "packages/api/src/routes.ts"),
      ],
      edges: [edge("e1", "imports", "file:caller", "file:core", 2, 1)],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "packages/api/src/session.ts" },
      repoGraph: graph,
      includePackages: false,
      historicalCoupling: [
        {
          relativePath: "packages/api/src/sessionStore.ts",
          coChangeCount: 5,
        },
      ],
    });

    expect(result.reasonCodes).toContain("hidden_coupling_detected");
    expect(result.hiddenCoupling.map((item) => item.relativePath)).toContain(
      "packages/api/src/sessionStore.ts",
    );
    expect(
      result.affectedFiles.some(
        (file) =>
          file.relativePath === "packages/api/src/sessionStore.ts" &&
          file.impactReason === "hidden_coupling",
      ),
    ).toBe(true);
    expect(recommendWidenVerification(result)).toBe(true);
  });

  it("detects cycles involving the seed neighborhood", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:a", "src/a.ts"),
        fileNode("file:b", "src/b.ts"),
        fileNode("file:c", "src/c.ts"),
      ],
      edges: [
        edge("e1", "imports", "file:a", "file:b", 1, 1),
        edge("e2", "imports", "file:b", "file:c", 1, 1),
        edge("e3", "imports", "file:c", "file:a", 1, 1),
      ],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/a.ts" },
      repoGraph: graph,
      includePackages: false,
      direction: "dependencies",
    });

    expect(result.reasonCodes).toContain("seed_cycle_detected");
    expect(result.cycles.length).toBeGreaterThan(0);
    expect(result.cycles[0]?.some((path) => path === "src/a.ts")).toBe(true);
    expect(result.blastRadius.detail).toMatch(/cycle/);
  });

  it("does not invent hidden coupling for weak unrelated co-change", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "packages/api/src/core.ts"),
        fileNode("file:caller", "packages/api/src/caller.ts"),
      ],
      edges: [edge("e1", "imports", "file:caller", "file:core", 1, 1)],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "packages/api/src/core.ts" },
      repoGraph: graph,
      includePackages: false,
      historicalCoupling: [
        { relativePath: "apps/web/src/unrelated.ts", coChangeCount: 3 },
      ],
    });

    expect(result.hiddenCoupling).toEqual([]);
    expect(result.reasonCodes).not.toContain("hidden_coupling_detected");
  });
});
