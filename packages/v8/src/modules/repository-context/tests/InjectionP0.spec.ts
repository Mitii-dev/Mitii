import { describe, expect, it } from "vitest";

import { HybridRetriever } from "../internal/hybrid-retrieval/HybridRetriever";
import {
  RepoMapRetrievalSource,
} from "../internal/hybrid-retrieval/sources/RepoMapRetrievalSource";
import type {
  RetrievalCandidate,
  RetrievalSource,
  RetrievalSourceResult,
} from "../internal/hybrid-retrieval/types";
import {
  buildHybridRetrievalRankingContext,
} from "../policy";
import type { RepoGraph, RepoMap } from "../../repository-state";

class StaticRetrievalSource implements RetrievalSource {
  constructor(
    public readonly id: string,
    private readonly result: RetrievalSourceResult,
  ) {}

  public canRetrieve(): boolean {
    return true;
  }

  public async retrieve(): Promise<RetrievalSourceResult> {
    return this.result;
  }
}

function candidate(
  relativePath: string,
  sourceScore: number,
): RetrievalCandidate {
  return {
    entityKind: "chunk",
    rootId: "root",
    relativePath,
    chunkId: relativePath,
    sourceScore,
    reasons: [
      {
        type: "lexical_match",
        evidence: `Matched ${relativePath}.`,
      },
    ],
  };
}

function repoMapEntry(
  relativePath: string,
  score: number,
): RepoMap["entries"][number] {
  return {
    file: {
      id: `file:${relativePath}`,
      rootId: "root",
      relativePath,
    },
    symbols: [],
    score,
    pageRank: 0,
    inboundImportCount: 0,
    outboundImportCount: 0,
    inboundReferenceCount: 0,
    outboundReferenceCount: 0,
    reasons: [
      {
        type: "page_rank",
        score,
        evidence: `Published score for ${relativePath}.`,
      },
    ],
  };
}

function fileGraph(paths: readonly string[]): RepoGraph {
  return {
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
    generatedAt: new Date(0).toISOString(),
  };
}

describe("repository-context P0 injection", () => {
  it("buildHybridRetrievalRankingContext collects session and priority paths", () => {
    const context = buildHybridRetrievalRankingContext({
      currentFile: { relativePath: "src/current.ts" },
      openFiles: [{ relativePath: "src/open.ts" }],
      explicitFiles: [{ relativePath: "src/explicit.ts" }],
      pinnedFiles: [
        { relativePath: "src/required.ts", priority: "required" },
        { relativePath: "src/preferred.ts", priority: "preferred" },
      ],
      currentSelection: {
        relativePath: "src/selection.ts",
        startLine: 1,
        endLine: 4,
      },
    });

    expect(context?.currentFile).toBe("src/current.ts");
    expect(context?.openFiles).toEqual(["src/open.ts"]);
    expect(context?.priorityPaths).toEqual([
      "src/explicit.ts",
      "src/required.ts",
      "src/selection.ts",
    ]);
  });

  it("query-time repo map re-rank prefers open files over published scores", async () => {
    const paths = [
      "src/feature/active.ts",
      "src/feature/archive.ts",
      "src/feature/readme.ts",
    ] as const;

    const publishedMap: RepoMap = {
      schemaVersion: 1,
      workspaceSnapshotId: "snapshot-1",
      codeIndexChangeToken: "change-1",
      entries: [
        repoMapEntry("src/feature/readme.ts", 1),
        repoMapEntry("src/feature/active.ts", 0.2),
        repoMapEntry("src/feature/archive.ts", 0.1),
      ],
      statistics: {
        availableFiles: 3,
        rankedFiles: 3,
        includedFiles: 3,
        includedSymbols: 0,
        estimatedTokens: 0,
        durationMs: 0,
      },
      status: "complete",
      generatedAt: new Date(0).toISOString(),
    };

    const result = await new HybridRetriever([
      { source: new RepoMapRetrievalSource() },
    ]).retrieve({
      workspace: "workspace",
      query: "feature",
      repoMap: publishedMap,
      repoGraph: fileGraph(paths),
      rankingContext: {
        openFiles: ["src/feature/archive.ts"],
      },
    });

    expect(result.candidates[0]?.relativePath).toBe(
      "src/feature/archive.ts",
    );
  });

  it("priority paths are prepended ahead of higher RRF lexical hits", async () => {
    const result = await new HybridRetriever([
      {
        source: new StaticRetrievalSource("lexical", {
          status: "complete",
          candidates: [
            candidate("src/noise/a.ts", 1),
            candidate("src/noise/b.ts", 0.95),
            candidate("src/target/Important.ts", 0.1),
          ],
          truncated: false,
          warnings: [],
        }),
        weight: 1,
      },
    ]).retrieve({
      workspace: "workspace",
      query: "find authentication handler",
      maximumResults: 3,
      rankingContext: {
        priorityPaths: ["src/target/Important.ts"],
      },
    });

    expect(result.candidates[0]?.relativePath).toBe(
      "src/target/Important.ts",
    );
  });
});
