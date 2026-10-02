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

  it("personalizes PageRank toward path components mentioned in the query", () => {
    const result = new RepoMapRanker().rank({
      graph: graph([
        "src/login/form.ts",
        "src/shared/utils.ts",
        "src/other/page.ts",
      ]),
      context: {
        query: "inspect the login flow helpers",
      },
    });

    expect(result.entries[0]?.file.relativePath).toBe("src/login/form.ts");
  });

  it("boosts call edges whose symbol is mentioned in the query", () => {
    const graphWithCalls: RepoGraph = {
      ...graph([
        "src/chat/Editor.tsx",
        "src/auth/LoginForm.tsx",
        "src/shared/utils.ts",
      ]),
      nodes: [
        ...graph([
          "src/chat/Editor.tsx",
          "src/auth/LoginForm.tsx",
          "src/shared/utils.ts",
        ]).nodes,
        {
          id: "sym:editor:renderLoginForm",
          kind: "symbol",
          symbolId: "sym:editor:renderLoginForm",
          fileId: "file:src/chat/Editor.tsx",
          name: "renderLoginForm",
          symbolKind: "function",
        },
        {
          id: "sym:login:LoginForm",
          kind: "symbol",
          symbolId: "sym:login:LoginForm",
          fileId: "file:src/auth/LoginForm.tsx",
          name: "LoginForm",
          symbolKind: "function",
        },
        {
          id: "sym:utils:helper",
          kind: "symbol",
          symbolId: "sym:utils:helper",
          fileId: "file:src/shared/utils.ts",
          name: "helper",
          symbolKind: "function",
        },
      ],
      edges: [
        {
          id: "e1",
          type: "calls",
          fromNodeId: "sym:editor:renderLoginForm",
          toNodeId: "sym:login:LoginForm",
          weight: 4,
          evidenceCount: 1,
          evidence: [{ source: "code_index_symbol" }],
          evidenceTruncated: false,
        },
        {
          id: "e2",
          type: "calls",
          fromNodeId: "sym:editor:renderLoginForm",
          toNodeId: "sym:utils:helper",
          weight: 40,
          evidenceCount: 1,
          evidence: [{ source: "code_index_symbol" }],
          evidenceTruncated: false,
        },
      ],
    };

    const result = new RepoMapRanker().rank({
      graph: graphWithCalls,
      context: {
        query: "Fix LoginForm validation",
        openFiles: ["src/chat/Editor.tsx"],
      },
    });

    const loginRank =
      result.entries.find(
        (entry) => entry.file.relativePath === "src/auth/LoginForm.tsx",
      )?.pageRank ?? 0;
    const utilsRank =
      result.entries.find(
        (entry) => entry.file.relativePath === "src/shared/utils.ts",
      )?.pageRank ?? 0;

    expect(loginRank).toBeGreaterThan(utilsRank);
  });
});
