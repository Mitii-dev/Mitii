import { describe, expect, it } from "vitest";

import {
  RepoGraphRetrievalSource,
} from "../internal/hybrid-retrieval/sources";

import type {
  NormalizedHybridRetrievalRequest,
} from "../internal/hybrid-retrieval/types";

import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphNode,
} from "../../repository-state";

describe("RepoGraphRetrievalSource blast radius", () => {
  it("walks call edges across bounded hops", async () => {
    const source =
      new RepoGraphRetrievalSource({
        maximumHops: 2,
        maximumNeighborsPerAnchor:
          4,
      });

    const result =
      await source.retrieve({
        ...baseRequest,
        query:
          "validateJwt",
        repoGraph:
          createGraph(
            [
              fileNode(
                "auth",
                "src/auth.ts",
              ),
              fileNode(
                "service",
                "src/service.ts",
              ),
              fileNode(
                "entry",
                "src/entry.ts",
              ),
              symbolNode(
                "auth",
                "validateJwt",
              ),
              symbolNode(
                "service",
                "validateSession",
              ),
              symbolNode(
                "entry",
                "main",
              ),
            ],
            [
              callEdge(
                "service-auth",
                "symbol:service",
                "symbol:auth",
              ),
              callEdge(
                "entry-service",
                "symbol:entry",
                "symbol:service",
              ),
            ],
          ),
      });

    expect(
      result.candidates.map(
        (candidate) =>
          candidate.relativePath,
      ),
    ).toEqual([
      "src/auth.ts",
      "src/service.ts",
      "src/entry.ts",
    ]);
    expect(
      result.candidates
        .slice(1)
        .every((candidate) =>
          candidate.reasons.some(
            (reason) =>
              reason.type ===
              "graph_call_neighbor",
          ),
        ),
    ).toBe(true);
  });

  it("honors the per-anchor neighbor budget during BFS", async () => {
    const source =
      new RepoGraphRetrievalSource({
        maximumHops: 2,
        maximumNeighborsPerAnchor:
          1,
      });

    const result =
      await source.retrieve({
        ...baseRequest,
        query:
          "validateJwt",
        repoGraph:
          createGraph(
            [
              fileNode(
                "auth",
                "src/auth.ts",
              ),
              fileNode(
                "service",
                "src/service.ts",
              ),
              fileNode(
                "entry",
                "src/entry.ts",
              ),
              symbolNode(
                "auth",
                "validateJwt",
              ),
              symbolNode(
                "service",
                "validateSession",
              ),
              symbolNode(
                "entry",
                "main",
              ),
            ],
            [
              callEdge(
                "service-auth",
                "symbol:service",
                "symbol:auth",
              ),
              callEdge(
                "entry-service",
                "symbol:entry",
                "symbol:service",
              ),
            ],
          ),
      });

    expect(
      result.candidates.map(
        (candidate) =>
          candidate.relativePath,
      ),
    ).toEqual([
      "src/auth.ts",
      "src/service.ts",
    ]);
  });

  it("does not explode on a dense call graph", async () => {
    const source =
      new RepoGraphRetrievalSource({
        maximumHops: 2,
        maximumNeighborsPerAnchor:
          3,
      });
    const files = Array.from(
      { length: 40 },
      (_, index) =>
        fileNode(
          `f${index}`,
          `src/f${index}.ts`,
        ),
    );
    const symbols = files.map((file, index) =>
      symbolNode(`f${index}`, `fn${index}`),
    );
    const edges = symbols.slice(1).map((symbol, index) =>
      callEdge(
        `e${index}`,
        symbol.id,
        "symbol:f0",
      ),
    );

    const result = await source.retrieve({
      ...baseRequest,
      query: "fn0",
      maximumResults: 8,
      maximumCandidatesPerSource: 8,
      repoGraph: createGraph(
        [...files, ...symbols],
        edges,
      ),
    });

    expect(result.status).not.toBe("failed");
    expect(result.candidates.length).toBeLessThanOrEqual(8);
    expect(result.truncated === true || result.candidates.length <= 8).toBe(
      true,
    );
  });
});

const baseRequest:
  NormalizedHybridRetrievalRequest = {
  workspace:
    "workspace",
  query:
    "validateJwt",
  rootIds: [],
  filePaths: [],
  kinds: [],
  maximumResults:
    10,
  maximumCandidatesPerSource:
    10,
};

function fileNode(
  id: string,
  relativePath: string,
): RepoGraphNode {
  return {
    id:
      `file:${id}`,
    kind:
      "file",
    fileId:
      id,
    rootId:
      "root",
    relativePath,
  };
}

function symbolNode(
  fileId: string,
  name: string,
): RepoGraphNode {
  return {
    id:
      `symbol:${fileId}`,
    kind:
      "symbol",
    symbolId:
      `symbol:${fileId}`,
    fileId,
    name,
    symbolKind:
      "function",
    startLine:
      1,
  };
}

function callEdge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
): RepoGraphEdge {
  return {
    id:
      `edge:${id}`,
    type:
      "calls",
    fromNodeId,
    toNodeId,
    weight:
      1,
    evidenceCount:
      1,
    evidence: [
      {
        source:
          "code_index_reference",
        detail:
          "call",
      },
    ],
    evidenceTruncated:
      false,
  };
}

function createGraph(
  nodes:
    RepoGraphNode[],
  edges:
    RepoGraphEdge[],
): RepoGraph {
  return {
    schemaVersion:
      1,
    workspaceSnapshotId:
      "snapshot-1",
    codeIndexChangeToken:
      "change-1",
    nodes,
    edges,
    warnings: [],
    statistics: {
      availableFiles:
        countNodes(
          nodes,
          "file",
        ),
      indexedFiles:
        countNodes(
          nodes,
          "file",
        ),
      projectNodes:
        countNodes(
          nodes,
          "project",
        ),
      fileNodes:
        countNodes(
          nodes,
          "file",
        ),
      symbolNodes:
        countNodes(
          nodes,
          "symbol",
        ),
      containsEdges:
        countEdges(
          edges,
          "contains",
        ),
      declaresEdges:
        countEdges(
          edges,
          "declares",
        ),
      importEdges:
        countEdges(
          edges,
          "imports",
        ),
      callEdges:
        countEdges(
          edges,
          "calls",
        ),
      referenceEdges:
        countEdges(
          edges,
          "references",
        ),
      projectRelationshipEdges:
        countEdges(
          edges,
          "workspace_member",
          "depends_on",
          "development_depends_on",
        ),
      unresolvedImports:
        0,
      omittedImportTargets:
        0,
      ambiguousReferences:
        0,
      unresolvedReferences:
        0,
      omittedReferenceTargets:
        0,
      omittedParentSymbolTargets:
        0,
      truncatedSymbolFiles:
        0,
      droppedSymbolNodes:
        0,
      droppedEdges:
        0,
      consistencyRetries:
        0,
      durationMs:
        0,
    },
    status:
      "complete",
    generatedAt:
      new Date(0)
        .toISOString(),
  };
}

function countNodes(
  nodes:
    readonly RepoGraphNode[],
  kind:
    RepoGraphNode["kind"],
): number {
  return nodes.filter(
    (node) =>
      node.kind === kind,
  ).length;
}

function countEdges(
  edges:
    readonly RepoGraphEdge[],
  ...types:
    RepoGraphEdge["type"][]
): number {
  const accepted =
    new Set(types);

  return edges.filter(
    (edge) =>
      accepted.has(edge.type),
  ).length;
}
