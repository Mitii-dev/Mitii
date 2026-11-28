import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  ChangeImpactPipeline,
  planCheckChangeImpact,
  recommendWidenVerification,
} from "../../index";
import {
  createGraph,
  edge,
  fileNode,
  projectNode,
} from "../fixtures/changeImpactGraphFixtures";

/**
 * Frozen oracle cases: expected affected paths / widen / spillover for a
 * small synthetic workspace. Failures here are accuracy regressions.
 */
const ORACLE = {
  core: "packages/api/src/core.ts",
  client: "packages/api/src/client.ts",
  web: "apps/web/src/page.ts",
  test: "packages/api/src/core.test.ts",
} as const;

function fixtureGraph() {
  return createGraph({
    nodes: [
      projectNode("project:api", "api", "api"),
      projectNode("project:web", "web", "web"),
      fileNode("file:core", ORACLE.core, "api"),
      fileNode("file:client", ORACLE.client, "api"),
      fileNode("file:web", ORACLE.web, "web"),
      fileNode("file:test", ORACLE.test, "api"),
    ],
    edges: [
      edge("e1", "imports", "file:client", "file:core", 3, 1),
      edge("e2", "imports", "file:web", "file:client", 2, 1),
      edge("e3", "imports", "file:test", "file:core", 2, 1),
      edge("e4", "depends_on", "project:web", "project:api", 1, 1),
    ],
  });
}

describe("ChangeImpact oracle harness", () => {
  it("marks hop-1 importers of core as affected", () => {
    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: ORACLE.core },
      repoGraph: fixtureGraph(),
      includePackages: false,
    });

    const paths = result.affectedFiles.map((file) => file.relativePath);
    expect(paths).toEqual(
      expect.arrayContaining([ORACLE.client, ORACLE.test]),
    );
    expect(result.affectedFiles.find((file) => file.relativePath === ORACLE.client)?.hop).toBe(
      1,
    );
    expect(result.status).toMatch(/ok|partial/);
  });

  it("plan-check unions proposed paths and sets widen when packages spill", () => {
    const result = planCheckChangeImpact({
      input: {
        schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
        proposedPaths: [ORACLE.core],
        repoGraph: fixtureGraph(),
        includePackages: true,
        expectedPackages: ["api"],
      },
    });

    expect(result.reasonCodes).toContain("plan_check_complete");
    expect(result.merged.affectedFiles.length).toBeGreaterThan(0);
    expect(result.spillover).toBeDefined();
    if (result.spillover && !result.spillover.withinExpected) {
      expect(result.widenVerification).toBe(true);
    }
  });

  it("recommendWidenVerification follows unsafe confidence", () => {
    const graph = createGraph({
      nodes: [fileNode("file:core", ORACLE.core)],
      edges: [],
      statistics: {
        unresolvedImports: 40,
        unresolvedReferences: 20,
        omittedImportTargets: 10,
      },
    });
    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: ORACLE.core },
      repoGraph: graph,
      includePackages: false,
    });
    expect(result.graphConfidenceUnsafe).toBe(true);
    expect(recommendWidenVerification(result)).toBe(true);
  });
});
