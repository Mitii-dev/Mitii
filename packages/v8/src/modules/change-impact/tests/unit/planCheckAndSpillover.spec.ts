import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  analyzeManyChangeImpact,
  evaluateSpillover,
  planCheckChangeImpact,
  spilloverTokensFromResult,
} from "../../index";
import {
  createGraph,
  edge,
  fileNode,
  projectNode,
} from "../fixtures/changeImpactGraphFixtures";

describe("change-impact multi-seed, spillover, and plan-check", () => {
  it("merges multiple seeds with min confidence and unioned files", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:a", "packages/api/src/a.ts", "api"),
        fileNode("file:b", "packages/api/src/b.ts", "api"),
        fileNode("file:c", "packages/web/src/c.ts", "web"),
        projectNode("project:api", "api", "@app/api"),
        projectNode("project:web", "web", "@app/web"),
      ],
      edges: [
        edge("e1", "imports", "file:c", "file:a", 2, 1),
        edge("e2", "imports", "file:c", "file:b", 2, 1),
      ],
      statistics: {
        unresolvedImports: 4,
        importEdges: 2,
      },
    });

    const { merged, results } = analyzeManyChangeImpact({
      input: {
        schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
        seeds: [
          { kind: "file", relativePath: "packages/api/src/a.ts" },
          { kind: "file", relativePath: "packages/api/src/b.ts" },
        ],
        repoGraph: graph,
        includePackages: true,
      },
    });

    expect(results).toHaveLength(2);
    expect(merged.seedCount).toBe(2);
    expect(merged.reasonCodes).toContain("multi_seed_merged");
    expect(merged.confidence).toBe(
      Math.min(results[0]!.confidence, results[1]!.confidence),
    );
    expect(merged.affectedFiles.map((file) => file.relativePath)).toContain(
      "packages/web/src/c.ts",
    );
  });

  it("flags spillover outside expected packages", () => {
    const spillover = evaluateSpillover({
      expectedPackages: ["packages/api", "@app/api"],
      affectedPackageIds: ["root:packages:web:app-web"],
      affectedPackageNames: ["@app/web"],
      affectedPackageRoots: ["packages/web"],
    });

    expect(spillover.withinExpected).toBe(false);
    expect(spillover.reasonCodes).toContain("spillover_detected");
    expect(spillover.spilloverPackages.length).toBeGreaterThan(0);
  });

  it("reports spillover_clean when impact stays inside expected packages", () => {
    const spillover = evaluateSpillover({
      expectedPackages: ["packages/api", "@app/api"],
      affectedPackageIds: [],
      affectedPackageNames: ["@app/api"],
      affectedPackageRoots: ["packages/api"],
    });

    expect(spillover.withinExpected).toBe(true);
    expect(spillover.reasonCodes).toContain("spillover_clean");
  });

  it("plan-checks proposed paths and evaluates expected package spillover", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "packages/api/src/core.ts", "api"),
        fileNode("file:web", "packages/web/src/page.ts", "web"),
        projectNode("project:api", "api", "@app/api"),
        projectNode("project:web", "web", "@app/web"),
      ],
      edges: [
        edge("e1", "imports", "file:web", "file:core", 2, 1),
        edge("e2", "depends_on", "project:web", "project:api", 1, 1),
      ],
    });

    const result = planCheckChangeImpact({
      input: {
        schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
        proposedPaths: ["packages/api/src/core.ts"],
        expectedPackages: ["packages/api", "@app/api"],
        repoGraph: graph,
        includePackages: true,
      },
    });

    expect(result.reasonCodes).toContain("plan_check_complete");
    expect(result.merged.affectedFiles.map((f) => f.relativePath)).toContain(
      "packages/web/src/page.ts",
    );
    expect(result.spillover).toBeDefined();
    expect(result.spillover?.withinExpected).toBe(false);
    expect(result.widenVerification).toBe(true);

    const tokens = spilloverTokensFromResult(result.merged);
    expect(tokens.affectedPackageRoots).toContain("packages/web");
  });
});
