import { describe, expect, it } from "vitest";

import { retainDeletedPathTombstones } from "../internal/repo-graph/retainDeletedPathTombstones";
import type { RepoGraph, RepoGraphFileNode } from "../internal/repo-graph/types";

function file(
  id: string,
  relativePath: string,
  tombstone?: boolean,
): RepoGraphFileNode {
  return {
    id,
    kind: "file",
    fileId: id,
    rootId: "workspace",
    relativePath,
    ...(tombstone ? { tombstone: true } : {}),
  };
}

function graph(nodes: RepoGraph["nodes"], edges: RepoGraph["edges"]): RepoGraph {
  const fileNodes = nodes.filter((node) => node.kind === "file").length;
  return {
    schemaVersion: 1,
    workspaceSnapshotId: "snap",
    codeIndexChangeToken: "tok",
    nodes,
    edges,
    warnings: [],
    statistics: {
      availableFiles: fileNodes,
      indexedFiles: fileNodes,
      projectNodes: 0,
      fileNodes,
      symbolNodes: 0,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: edges.filter((edge) => edge.type === "imports").length,
      callEdges: 0,
      referenceEdges: 0,
      projectRelationshipEdges: 0,
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
    status: "complete",
    generatedAt: "2026-08-13T00:00:00.000Z",
  };
}

describe("retainDeletedPathTombstones", () => {
  it("keeps deleted prior files as tombstones with linking edges", () => {
    const prior = graph(
      [file("file:old", "src/old.ts"), file("file:alive", "src/alive.ts")],
      [
        {
          id: "e1",
          type: "imports",
          fromNodeId: "file:alive",
          toNodeId: "file:old",
          weight: 1,
          evidenceCount: 1,
          evidence: [{ source: "code_index_import" }],
          evidenceTruncated: false,
        },
      ],
    );
    const next = graph([file("file:alive", "src/alive.ts")], []);

    const merged = retainDeletedPathTombstones({
      graph: next,
      priorGraph: prior,
      presentRelativePaths: new Set(["src/alive.ts"]),
    });

    const tombstone = merged.nodes.find(
      (node) => node.kind === "file" && node.relativePath === "src/old.ts",
    ) as RepoGraphFileNode | undefined;
    expect(tombstone?.tombstone).toBe(true);
    expect(merged.edges.some((edge) => edge.id === "e1")).toBe(true);
    expect(merged.statistics.fileNodes).toBe(2);
    expect(merged.statistics.indexedFiles).toBe(2);
  });

  it("skips paths still present on disk even if missing from the new graph", () => {
    const prior = graph([file("file:old", "src/old.ts")], []);
    const next = graph([], []);
    const merged = retainDeletedPathTombstones({
      graph: next,
      priorGraph: prior,
      presentRelativePaths: new Set(["src/old.ts"]),
    });
    expect(merged.nodes).toHaveLength(0);
  });
});
