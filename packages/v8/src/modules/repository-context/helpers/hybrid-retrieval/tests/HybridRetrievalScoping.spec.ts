import { describe, expect, it } from "vitest";
import { HybridRetrievalFactory } from "../HybridRetrievalFactory";
import { HybridRetriever } from "../HybridRetriever";
import { RepoMapRetrievalSource } from "../sources";
import type {
  NormalizedHybridRetrievalRequest,
  RetrievalSource,
} from "../types";
import type { RepoGraph, RepoMap } from "../../../../repository-state/index";
import {
  StaticRetrievalSource,
  candidate,
  complete,
  baseInput,
  repoMapEntry,
} from "./hybridRetrievalHarness";

const epoch = new Date(0).toISOString();

function createRepoMap(
  workspaceSnapshotId: string,
  entries: RepoMap["entries"],
): RepoMap {
  return {
    schemaVersion: 1,
    workspaceSnapshotId,
    codeIndexChangeToken: "change-1",
    entries,
    statistics: {
      availableFiles: entries.length,
      rankedFiles: entries.length,
      includedFiles: entries.length,
      includedSymbols: 0,
      estimatedTokens: 0,
      durationMs: 0,
    },
    status: "complete",
    generatedAt: epoch,
  };
}

describe("HybridRetriever scoping", () => {
  it("snapshot consistency guards rebind stale repository intelligence and continue", async () => {
    const retriever = new HybridRetriever([
      {
        source: new StaticRetrievalSource(
          "lexical",
          complete([candidate("src/auth.ts", "auth", 0.9)]),
        ),
      },
    ]);

    const result = await retriever.retrieve({
      ...baseInput,
      workspaceSnapshotId: "snapshot-a",
      repoMap: createRepoMap("snapshot-b", []),
    });

    expect(result.candidates.length).toBe(1);
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "optional_source_unavailable" &&
          /workspace snapshot/i.test(warning.message),
      ),
    ).toBe(true);
  });

  it("directory-like file paths are promoted to folderPrefix", async () => {
    let captured: NormalizedHybridRetrievalRequest | undefined;
    const capture: RetrievalSource = {
      id: "capture",
      canRetrieve: () => true,
      retrieve: async (request) => {
        captured = request;
        return {
          status: "empty",
          candidates: [],
          truncated: false,
          warnings: [],
        };
      },
    };

    await new HybridRetriever([{ source: capture }]).retrieve({
      ...baseInput,
      filePaths: ["packages/demo"],
    });

    expect(captured?.folderPrefix).toBe("packages/demo");
    expect(captured?.filePaths).toEqual([]);
  });

  it("repo map scope includes explicit files plus folder contents", async () => {
    const map = createRepoMap("snapshot-1", [
      repoMapEntry("packages/mui-builder/src/FormBuilder.tsx", 0.9),
      repoMapEntry("tsconfig.json", 0.8),
      repoMapEntry("packages/other/src/Other.ts", 1),
    ]);

    const result = await new HybridRetriever([
      { source: new RepoMapRetrievalSource() },
    ]).retrieve({
      ...baseInput,
      folderPrefix: "packages/mui-builder",
      filePaths: ["tsconfig.json"],
      repoMap: map,
    });

    expect(result.candidates.map((entry) => entry.relativePath)).toEqual([
      "packages/mui-builder/src/FormBuilder.tsx",
      "tsconfig.json",
    ]);
  });

  it("factory rejects incomplete vector configuration", () => {
    const factory = new HybridRetrievalFactory();

    expect(() => factory.create({ vectorIndex: {} as never })).toThrow(
      /must be configured together/i,
    );
  });

  it("query-time repo map re-rank prefers open files over published scores", async () => {
    const paths = [
      "src/feature/active.ts",
      "src/feature/archive.ts",
      "src/feature/readme.ts",
    ] as const;
    const graph: RepoGraph = {
      schemaVersion: 1,
      workspaceSnapshotId: "snapshot-1",
      codeIndexChangeToken: "change-1",
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
      generatedAt: epoch,
    };

    const publishedMap = createRepoMap("snapshot-1", [
      repoMapEntry("src/feature/readme.ts", 1),
      repoMapEntry("src/feature/active.ts", 0.2),
      repoMapEntry("src/feature/archive.ts", 0.1),
    ]);

    const result = await new HybridRetriever([
      { source: new RepoMapRetrievalSource() },
    ]).retrieve({
      ...baseInput,
      query: "feature",
      repoMap: publishedMap,
      repoGraph: graph,
      rankingContext: { openFiles: ["src/feature/archive.ts"] },
    });

    expect(result.candidates[0]?.relativePath).toBe("src/feature/archive.ts");
  });

  it("priority paths are prepended ahead of higher RRF lexical hits", async () => {
    const result = await new HybridRetriever([
      {
        source: new StaticRetrievalSource(
          "lexical",
          complete([
            candidate("src/noise/a.ts", "a", 1),
            candidate("src/noise/b.ts", "b", 0.95),
            candidate("src/target/Important.ts", "important", 0.1),
          ]),
        ),
        weight: 1,
      },
    ]).retrieve({
      ...baseInput,
      maximumResults: 3,
      rankingContext: { priorityPaths: ["src/target/Important.ts"] },
    });

    expect(result.candidates[0]?.relativePath).toBe(
      "src/target/Important.ts",
    );
  });
});
