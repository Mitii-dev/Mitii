import { describe, expect, it } from "vitest";

import type { RepoGraph } from "../../repo-graph/types";
import { RepoMapRanker } from "../ranking/RepoMapRanker";

function graph(paths: readonly string[]): RepoGraph {
  return {
    schemaVersion: 1,
    workspaceSnapshotId: "snap_1",
    codeIndexChangeToken: "idx_1",
    nodes: paths.map((relativePath) => ({
      id: `file:${relativePath}`,
      kind: "file" as const,
      fileId: `file:${relativePath}`,
      rootId: "root",
      relativePath,
    })),
    edges: [],
    warnings: [],
    statistics: {
      availableFiles: paths.length,
      indexedFiles: paths.length,
      projectNodes: 0,
      fileNodes: paths.length,
      symbolNodes: 0,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: 0,
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
      durationMs: 0,
    },
    status: "complete",
    generatedAt: new Date(0).toISOString(),
  };
}

describe("RepoMapRanker", () => {
  it("boosts explicitly mentioned paths above generic path term matches", () => {
    const result = new RepoMapRanker().rank({
      graph: graph([
        "src/auth/session.ts",
        "src/auth/index.ts",
        "src/shared/session.ts",
      ]),
      context: {
        query: "Fix the null crash in src/auth/session.ts",
      },
    });

    expect(result.entries[0]?.file.relativePath).toBe("src/auth/session.ts");
    expect(result.entries[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "query_path",
          evidence:
            'Path "src/auth/session.ts" was explicitly mentioned in the query.',
        }),
      ]),
    );
  });

  it("boosts open files even when the query terms are broad", () => {
    const result = new RepoMapRanker().rank({
      graph: graph([
        "src/feature/active.ts",
        "src/feature/archive.ts",
        "src/feature/readme.ts",
      ]),
      context: {
        query: "feature",
        openFiles: ["src/feature/archive.ts"],
      },
    });

    expect(result.entries[0]?.file.relativePath).toBe(
      "src/feature/archive.ts",
    );
    expect(result.entries[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "open_file",
        }),
      ]),
    );
  });
});
