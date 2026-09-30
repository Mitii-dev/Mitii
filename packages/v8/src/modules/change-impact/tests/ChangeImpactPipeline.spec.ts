import { describe, expect, it } from "vitest";

import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphProjectNode,
  RepoGraphSymbolNode,
} from "../../repository-state";
import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  ChangeImpactPipeline,
  changeImpactInputSchema,
  changeImpactResultSchema,
} from "../index";

describe("ChangeImpactPipeline", () => {
  it("walks reverse call dependents across bounded hops", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        symbolNode("sym:validate", "file:core", "validateJwt", 1, 4),
        fileNode("file:caller", "src/caller.ts"),
        symbolNode("sym:caller", "file:caller", "requireAuth", 10, 13),
        fileNode("file:route", "src/route.ts"),
        symbolNode("sym:route", "file:route", "handleRoute", 20, 24),
      ],
      edges: [
        edge("e1", "calls", "sym:caller", "sym:validate", 5, 11),
        edge("e2", "calls", "sym:route", "sym:caller", 3, 21),
      ],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: {
        kind: "symbol",
        relativePath: "src/core.ts",
        symbolName: "validateJwt",
      },
      repoGraph: graph,
      maximumHops: 2,
      includePackages: false,
    });

    expect(() => changeImpactResultSchema.parse(result)).not.toThrow();
    expect(result.status).toBe("ok");
    expect(result.affected.map((node) => node.symbolName)).toEqual([
      "requireAuth",
      "handleRoute",
    ]);
    expect(result.affectedFiles.map((file) => file.relativePath)).toEqual([
      "src/caller.ts",
      "src/route.ts",
    ]);
    expect(result.directNeighborCounts).toEqual({ nodes: 1, files: 1 });
    expect(result.affectedFiles.every((file) => file.bucket === "prod")).toBe(
      true,
    );
    expect(result.chains.length).toBeGreaterThan(0);
    expect(result.chains[0]?.links.map((link) => link.symbolName)).toEqual([
      "validateJwt",
      "requireAuth",
      "handleRoute",
    ]);
    expect(result.affected[0]?.evidence?.[0]).toMatch(/^chain:/);
  });

  it("defaults file seeds to exported symbols instead of every symbol", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        symbolNode("sym:public", "file:core", "publicApi", 1, 4, true),
        symbolNode("sym:private", "file:core", "helper", 6, 8, false),
        fileNode("file:consumer", "src/consumer.ts"),
        symbolNode("sym:use", "file:consumer", "usePublic", 1, 3),
      ],
      edges: [
        edge("e1", "calls", "sym:use", "sym:public", 4, 2),
        edge("e2", "calls", "sym:private", "sym:public", 1, 7),
      ],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      repoGraph: graph,
      includePackages: false,
    });

    expect(
      result.resolvedSeeds.map((seed) => seed.symbolName ?? seed.kind).sort(),
    ).toEqual(["file", "publicApi"]);
    expect(result.resolvedSeeds.some((seed) => seed.symbolName === "helper")).toBe(
      false,
    );
    expect(result.affected.map((node) => node.symbolName)).toContain("usePublic");
  });

  it("partitions test dependents behind prod at the same hop", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        fileNode("file:app", "src/App.tsx"),
        fileNode("file:test", "src/core.test.ts"),
      ],
      edges: [
        edge("e1", "imports", "file:app", "file:core", 2, 1),
        edge("e2", "imports", "file:test", "file:core", 5, 1),
      ],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.affectedFiles.map((file) => file.relativePath)).toEqual([
      "src/App.tsx",
      "src/core.test.ts",
    ]);
    expect(result.affectedFiles[0]?.bucket).toBe("prod");
    expect(result.affectedFiles[1]?.bucket).toBe("test");
    expect(result.directNeighborCounts).toEqual({ nodes: 2, files: 2 });
  });

  it("marks path_limit_reached when chain budget is exhausted", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        ...Array.from({ length: 6 }, (_, index) =>
          fileNode(`file:c${index}`, `src/c${index}.ts`),
        ),
      ],
      edges: Array.from({ length: 6 }, (_, index) =>
        edge(`e${index}`, "imports", `file:c${index}`, "file:core", 1, 1),
      ),
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      repoGraph: graph,
      maximumHops: 1,
      maximumPaths: 2,
      includePackages: false,
    });

    expect(result.status).toBe("partial");
    expect(result.reasonCodes).toContain("path_limit_reached");
    expect(result.chains.length).toBeLessThanOrEqual(2);
  });

  it("walks reverse import dependents for file seeds", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        fileNode("file:consumer", "src/consumer.ts"),
      ],
      edges: [edge("e1", "imports", "file:consumer", "file:core", 4, 2)],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      repoGraph: graph,
    });

    expect(result.status).toBe("ok");
    expect(result.affected[0]).toMatchObject({
      kind: "file",
      relativePath: "src/consumer.ts",
      viaEdgeType: "imports",
      hop: 1,
    });
  });

  it("walks forward import dependencies for file seeds", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        fileNode("file:types", "src/types.ts"),
        fileNode("file:consumer", "src/consumer.ts"),
      ],
      edges: [
        edge("e1", "imports", "file:core", "file:types", 4, 2),
        edge("e2", "imports", "file:consumer", "file:core", 3, 1),
      ],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      direction: "dependencies",
      repoGraph: graph,
      maximumHops: 1,
      includePackages: false,
    });

    expect(result.status).toBe("ok");
    expect(result.direction).toBe("dependencies");
    expect(result.affected.map((node) => node.relativePath)).toEqual([
      "src/types.ts",
    ]);
    expect(result.affectedFiles.map((file) => file.relativePath)).not.toContain(
      "src/consumer.ts",
    );
  });

  it("reports no_dependencies when the seed imports nothing", () => {
    const graph = createGraph({
      nodes: [fileNode("file:core", "src/core.ts")],
      edges: [],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      direction: "dependencies",
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.status).toBe("empty");
    expect(result.reasonCodes).toContain("no_dependencies");
    expect(result.reasonCodes).not.toContain("no_dependents");
  });

  it("reports package dependents when requested", () => {
    const graph = createGraph({
      nodes: [
        projectNode("project:lib", "pkg-lib", "pkg-lib"),
        projectNode("project:app", "pkg-app", "pkg-app"),
        fileNode("file:core", "packages/lib/src/core.ts", "pkg-lib"),
      ],
      edges: [
        edge("e1", "depends_on", "project:app", "project:lib", 2, 1),
      ],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: {
        kind: "file",
        relativePath: "packages/lib/src/core.ts",
      },
      repoGraph: graph,
      includePackages: true,
    });

    expect(result.status).toBe("ok");
    expect(result.packagesAffected).toEqual([
      {
        projectId: "pkg-app",
        name: "pkg-app",
        hop: 1,
        viaEdgeType: "depends_on",
      },
    ]);
  });

  it("marks hop and node caps as partial with reason codes", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        symbolNode("sym:validate", "file:core", "validateJwt", 1, 4),
        fileNode("file:caller", "src/caller.ts"),
        symbolNode("sym:caller", "file:caller", "requireAuth", 10, 13),
        fileNode("file:route", "src/route.ts"),
        symbolNode("sym:route", "file:route", "handleRoute", 20, 24),
      ],
      edges: [
        edge("e1", "calls", "sym:caller", "sym:validate", 5, 11),
        edge("e2", "calls", "sym:route", "sym:caller", 3, 21),
      ],
    });

    const hopLimited = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: {
        kind: "symbol",
        relativePath: "src/core.ts",
        symbolName: "validateJwt",
      },
      repoGraph: graph,
      maximumHops: 1,
      includePackages: false,
    });

    expect(hopLimited.status).toBe("partial");
    expect(hopLimited.reasonCodes).toContain("hop_limit_reached");
    expect(hopLimited.affected.map((node) => node.symbolName)).toEqual([
      "requireAuth",
    ]);

    const nodeLimited = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: {
        kind: "symbol",
        relativePath: "src/core.ts",
        symbolName: "validateJwt",
      },
      repoGraph: graph,
      maximumAffectedNodes: 1,
      includePackages: false,
    });

    expect(nodeLimited.status).toBe("partial");
    expect(nodeLimited.reasonCodes).toContain("node_limit_reached");
  });

  it("reports unresolved and stale graphs honestly", () => {
    const graph = createGraph({
      nodes: [fileNode("file:core", "src/core.ts")],
      edges: [],
    });

    const unresolved = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/missing.ts" },
      repoGraph: graph,
    });

    expect(unresolved.status).toBe("empty");
    expect(unresolved.reasonCodes).toEqual(["seed_unresolved"]);

    const stale = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/missing.ts" },
      repoGraph: graph,
      codeIndexChangeToken: "newer-token",
    });

    expect(stale.status).toBe("partial");
    expect(stale.reasonCodes).toContain("graph_stale");
    expect(stale.reasonCodes).toContain("seed_unresolved");
  });

  it("validates input and output schemas", () => {
    const graph = createGraph({
      nodes: [fileNode("file:core", "src/core.ts")],
      edges: [],
    });

    const input = changeImpactInputSchema.parse({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      repoGraph: graph,
    });
    const result = new ChangeImpactPipeline().analyze(input);

    expect(() => changeImpactResultSchema.parse(result)).not.toThrow();
    expect(result.status).toBe("empty");
    expect(result.reasonCodes).toContain("no_dependents");
  });

  it("soft-resolves case-insensitive symbol names before file expand", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        symbolNode("sym:validate", "file:core", "validateJwt", 1, 4),
        fileNode("file:caller", "src/caller.ts"),
        symbolNode("sym:caller", "file:caller", "requireAuth", 10, 13),
      ],
      edges: [edge("e1", "calls", "sym:caller", "sym:validate", 5, 11)],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: {
        kind: "symbol",
        relativePath: "src/core.ts",
        symbolName: "ValidateJwt",
      },
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.reasonCodes).toContain("seed_soft_resolved");
    expect(result.warnings.some((w) => w.code === "seed_soft_matched")).toBe(
      true,
    );
    expect(result.resolvedSeeds.some((s) => s.symbolName === "validateJwt")).toBe(
      true,
    );
    expect(result.affected.map((node) => node.symbolName)).toContain(
      "requireAuth",
    );
  });

  it("soft-resolves via textOccurrenceHints covering lines", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        symbolNode("sym:a", "file:core", "alpha", 1, 5),
        symbolNode("sym:b", "file:core", "beta", 10, 15),
        fileNode("file:caller", "src/caller.ts"),
        symbolNode("sym:caller", "file:caller", "useBeta", 1, 3),
      ],
      edges: [edge("e1", "calls", "sym:caller", "sym:b", 2, 2)],
    });

    const result = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: {
        kind: "symbol",
        relativePath: "src/core.ts",
        symbolName: "missingExact",
      },
      textOccurrenceHints: [{ line: 12 }],
      repoGraph: graph,
      includePackages: false,
    });

    expect(result.reasonCodes).toContain("seed_soft_resolved");
    expect(result.resolvedSeeds.some((s) => s.symbolName === "beta")).toBe(true);
    expect(result.affected.map((node) => node.symbolName)).toContain("useBeta");
  });

  it("boosts scores from published importanceByRelativePath", () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:core", "src/core.ts"),
        fileNode("file:hot", "src/hot.ts"),
        fileNode("file:cold", "src/cold.ts"),
      ],
      edges: [
        edge("e1", "imports", "file:hot", "file:core", 2, 1),
        edge("e2", "imports", "file:cold", "file:core", 2, 1),
      ],
    });

    const without = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      repoGraph: graph,
      includePackages: false,
    });

    const withImportance = new ChangeImpactPipeline().analyze({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      seed: { kind: "file", relativePath: "src/core.ts" },
      repoGraph: graph,
      includePackages: false,
      importanceByRelativePath: {
        "src/hot.ts": 1,
        "src/cold.ts": 0,
      },
    });

    const hotWithout = without.affectedFiles.find(
      (f) => f.relativePath === "src/hot.ts",
    )!.score;
    const hotWith = withImportance.affectedFiles.find(
      (f) => f.relativePath === "src/hot.ts",
    )!.score;
    const coldWith = withImportance.affectedFiles.find(
      (f) => f.relativePath === "src/cold.ts",
    )!.score;

    expect(hotWith).toBeGreaterThan(hotWithout);
    expect(hotWith).toBeGreaterThan(coldWith);
    expect(withImportance.affectedFiles[0]?.relativePath).toBe("src/hot.ts");
  });
});

function createGraph(input: {
  nodes: readonly RepoGraphNode[];
  edges: readonly RepoGraphEdge[];
  status?: RepoGraph["status"];
}): RepoGraph {
  return {
    schemaVersion: 1,
    workspaceSnapshotId: "snapshot-1",
    codeIndexChangeToken: "token-1",
    nodes: [...input.nodes],
    edges: [...input.edges],
    warnings: [],
    statistics: {
      availableFiles: input.nodes.filter((node) => node.kind === "file").length,
      indexedFiles: input.nodes.filter((node) => node.kind === "file").length,
      projectNodes: input.nodes.filter((node) => node.kind === "project").length,
      fileNodes: input.nodes.filter((node) => node.kind === "file").length,
      symbolNodes: input.nodes.filter((node) => node.kind === "symbol").length,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: input.edges.filter((edge) => edge.type === "imports").length,
      callEdges: input.edges.filter((edge) => edge.type === "calls").length,
      referenceEdges: input.edges.filter((edge) => edge.type === "references").length,
      projectRelationshipEdges: input.edges.filter(
        (edge) => edge.type === "depends_on" || edge.type === "development_depends_on",
      ).length,
      unresolvedImports: 0,
      omittedImportTargets: 0,
      ambiguousReferences: 0,
      unresolvedReferences: 0,
      omittedReferenceTargets: 0,
      omittedParentSymbolTargets: 0,
      truncatedSymbolFiles: 0,
      droppedSymbolNodes: 0,
      droppedEdges: 0,
      consistencyRetries: 0,
      durationMs: 1,
    },
    status: input.status ?? "complete",
    generatedAt: "2026-08-13T00:00:00.000Z",
  };
}

function projectNode(
  id: string,
  projectId: string,
  name: string,
): RepoGraphProjectNode {
  return {
    id,
    kind: "project",
    projectId,
    rootId: "workspace",
    relativeRoot: "",
    name,
    ecosystems: ["node"],
  };
}

function fileNode(
  id: string,
  relativePath: string,
  projectId?: string,
): RepoGraphFileNode {
  return {
    id,
    kind: "file",
    fileId: id,
    rootId: "workspace",
    relativePath,
    ...(projectId ? { projectId } : {}),
  };
}

function symbolNode(
  id: string,
  fileId: string,
  name: string,
  startLine: number,
  endLine: number,
  exported?: boolean,
): RepoGraphSymbolNode {
  return {
    id,
    kind: "symbol",
    symbolId: id,
    fileId,
    name,
    symbolKind: "function",
    startLine,
    endLine,
    ...(exported === undefined ? {} : { exported }),
  };
}

function edge(
  id: string,
  type: RepoGraphEdge["type"],
  fromNodeId: string,
  toNodeId: string,
  weight: number,
  line: number,
): RepoGraphEdge {
  return {
    id,
    type,
    fromNodeId,
    toNodeId,
    weight,
    evidenceCount: 1,
    evidence: [
      {
        source: type === "depends_on" ? "project_catalog" : "code_index_reference",
        detail: `${fromNodeId} ${type} ${toNodeId}`,
        line,
      },
    ],
    evidenceTruncated: false,
  };
}
