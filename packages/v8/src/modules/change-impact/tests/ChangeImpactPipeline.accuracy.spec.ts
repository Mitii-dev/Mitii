import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  ChangeImpactPipeline,
} from "../index";
import {
  createGraph,
  edge,
  fileNode,
  projectNode,
  symbolNode,
} from "./fixtures/changeImpactGraphFixtures";

describe("ChangeImpactPipeline accuracy", () => {
  it("marks graph_confidence_unsafe and forces partial when unresolved dominate", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        fileNode("file:caller", "src/caller.ts"),
      ],
      edges: [edge("e1", "imports", "file:caller", "file:core", 2, 1)],
      statistics: {
        unresolvedImports: 20,
        unresolvedReferences: 10,
        omittedImportTargets: 5,
      },
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.graphConfidenceUnsafe).toBe(true);
    expect(result.status).toBe("partial");
    expect(result.reasonCodes).toContain("graph_confidence_unsafe");
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.totals.affectedFiles).toBe(result.affectedFiles.length);
    expect(result.blastRadius.riskTier).toBeTruthy();
    expect(result.affectedFiles[0]?.impactReason).toBe("direct");
  });

  it("walks workspace_member edges when includePackages is true", () => {
    const graph = createGraph({
      nodes: [
        projectNode("project:root", "root", "root"),
        projectNode("project:pkg", "pkg", "pkg"),
        fileNode("file:core", "packages/pkg/src/core.ts", "pkg"),
      ],
      edges: [
        edge("e1", "workspace_member", "project:root", "project:pkg", 1, 1),
        edge("e2", "depends_on", "project:pkg", "project:root", 1, 1),
      ],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "packages/pkg/src/core.ts" },
      repoGraph: graph,
      includePackages: true,
      direction: "dependencies",
    });

    expect(result.packagesAffected.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.blastRadius.level).toMatch(/low|medium|high/);
  });

  it("raises risk for sensitive seed paths", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:auth", "src/auth/session.ts"),
        fileNode("file:caller", "src/app.ts"),
      ],
      edges: [edge("e1", "imports", "file:caller", "file:auth", 3, 1)],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/auth/session.ts" },
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.blastRadius.riskScore).toBeGreaterThanOrEqual(21);
    expect(["review", "test", "critical"]).toContain(
      result.blastRadius.riskTier,
    );
  });
});
