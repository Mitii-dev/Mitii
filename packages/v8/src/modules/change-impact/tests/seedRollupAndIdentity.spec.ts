import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  ChangeImpactPipeline,
} from "../index";
import {
  createGraph,
  edge,
  fileNode,
  symbolNode,
} from "./fixtures/changeImpactGraphFixtures";

describe("change-impact seed rollup and path identity", () => {
  it("expands method seeds to parent type and finds type-level callers", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        symbolNode("sym:Auth", "file:core", "AuthService", 1, 40, true),
        symbolNode(
          "sym:login",
          "file:core",
          "login",
          10,
          20,
          true,
          "sym:Auth",
        ),
        fileNode("file:caller", "src/caller.ts"),
        symbolNode("sym:use", "file:caller", "useAuth", 1, 5),
      ],
      edges: [
        edge("e1", "calls", "sym:use", "sym:Auth", 3, 2),
      ],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: {
        kind: "symbol",
        relativePath: "src/core.ts",
        symbolName: "login",
      },
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.reasonCodes).toContain("seed_rollup_expanded");
    expect(result.resolvedSeeds.some((seed) => seed.symbolName === "AuthService")).toBe(
      true,
    );
    expect(result.affected.map((node) => node.symbolName)).toContain("useAuth");
  });

  it("dual-seeds renamed prior path so old dependents remain reachable", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:old", "src/legacy.ts"),
        fileNode("file:new", "src/current.ts"),
        fileNode("file:caller", "src/caller.ts"),
      ],
      edges: [edge("e1", "imports", "file:caller", "file:old", 2, 1)],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/current.ts" },
      pathIdentityOverlays: [
        {
          kind: "renamed",
          fromRelativePath: "src/legacy.ts",
          toRelativePath: "src/current.ts",
        },
      ],
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.reasonCodes).toContain("path_identity_remapped");
    expect(result.affectedFiles.map((file) => file.relativePath)).toContain(
      "src/caller.ts",
    );
  });

  it("resolves deleted seed path when the prior file node is still present", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:gone", "src/removed.ts"),
        fileNode("file:caller", "src/caller.ts"),
      ],
      edges: [edge("e1", "imports", "file:caller", "file:gone", 2, 1)],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/removed.ts" },
      pathIdentityOverlays: [
        {
          kind: "deleted",
          fromRelativePath: "src/removed.ts",
        },
      ],
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.reasonCodes).toContain("path_identity_remapped");
    expect(result.affectedFiles.map((file) => file.relativePath)).toContain(
      "src/caller.ts",
    );
  });
});
