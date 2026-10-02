import { describe, expect, it } from "vitest";

import { HybridRetriever } from "../internal/hybrid-retrieval/HybridRetriever";
import {
  SessionContextRetrievalSource,
} from "../internal/hybrid-retrieval/sources/SessionContextRetrievalSource";
import { buildHybridRetrievalRankingContext } from "../policy";

import {
  isImportantRepoMapFile,
} from "../../repository-state/internal/repo-map/importantFiles";
import {
  REPO_MAP_DEFAULTS,
} from "../../repository-state/internal/repo-map/constants";
import {
  RepoMapBudgetApplier,
} from "../../repository-state/internal/repo-map/RepoMapBudgetApplier";
import { RepoMapBuilder } from "../../repository-state/internal/repo-map/RepoMapBuilder";
import { RepoMapRanker } from "../../repository-state/internal/repo-map/ranking/RepoMapRanker";
import type {
  RepoMapEntry,
} from "../../repository-state/internal/repo-map/types";
import type { RepoGraph } from "../../repository-state/internal/repo-graph/types";
import {
  TEXT_INDEX_FTS,
} from "../../repository-state/internal/text-index/constants";
import {
  TextQueryNormalizer,
} from "../../repository-state/internal/text-index/TextQueryNormalizer";

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

function entry(
  relativePath: string,
  score: number,
  symbolChars = 40,
): RepoMapEntry {
  return {
    file: {
      id: `file:${relativePath}`,
      rootId: "root",
      relativePath,
    },
    symbols: [
      {
        id: `sym:${relativePath}`,
        fileId: `file:${relativePath}`,
        name: "x".repeat(symbolChars),
        kind: "function",
      },
    ],
    score,
    pageRank: score,
    inboundImportCount: 0,
    outboundImportCount: 0,
    inboundReferenceCount: 0,
    outboundReferenceCount: 0,
    reasons: [],
  };
}

describe("repository-context P2 injection", () => {
  it("pins important project files above unrelated peers", () => {
    expect(isImportantRepoMapFile("README.md")).toBe(true);
    expect(isImportantRepoMapFile("package.json")).toBe(true);
    expect(isImportantRepoMapFile("src/utils.ts")).toBe(false);

    const result = new RepoMapRanker().rank({
      graph: graph([
        "src/utils.ts",
        "README.md",
        "src/helpers.ts",
        "package.json",
      ]),
      context: {
        query: "how does the project start",
      },
    });

    const paths = result.entries.map(
      (item) => item.file.relativePath,
    );
    expect(paths.indexOf("README.md")).toBeLessThan(
      paths.indexOf("src/utils.ts"),
    );
    expect(paths.indexOf("package.json")).toBeLessThan(
      paths.indexOf("src/helpers.ts"),
    );
    expect(result.entries[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "important_file" }),
      ]),
    );
  });

  it("binary-searches the densest prefix that fits the token budget", () => {
    const entries = Array.from({ length: 20 }, (_, index) =>
      entry(`src/f${index}.ts`, 1 - index * 0.01, 80),
    );

    const result = new RepoMapBudgetApplier().apply(entries, {
      maximumEntries: 20,
      minimumEntries: 2,
      maximumEstimatedTokens: 120,
      maximumSymbolsPerEntry: 5,
    });

    expect(result.entries.length).toBeGreaterThanOrEqual(2);
    expect(result.entries.length).toBeLessThan(20);
    expect(result.estimatedTokens).toBeLessThanOrEqual(120);
    expect(result.truncated).toBe(true);

    // Prefix preserves rank order (binary search over ranked head).
    expect(result.entries.map((item) => item.file.relativePath)).toEqual(
      entries
        .slice(0, result.entries.length)
        .map((item) => item.file.relativePath),
    );
  });

  it("enlarges map token budget when ranking has no session files", () => {
    const paths = Array.from(
      { length: 40 },
      (_, index) => `src/module_${index}.ts`,
    );

    const cold = new RepoMapBuilder().build({
      graph: graph(paths),
      ranking: { query: "module layout" },
      budget: {
        maximumEntries: 40,
        minimumEntries: 3,
        // Tight enough that only ~12 empty-symbol entries fit without mul.
        maximumEstimatedTokens: 50,
        maximumSymbolsPerEntry: 5,
      },
    });

    const warm = new RepoMapBuilder().build({
      graph: graph(paths),
      ranking: {
        query: "module layout",
        currentFile: "src/module_0.ts",
      },
      budget: {
        maximumEntries: 40,
        minimumEntries: 3,
        maximumEstimatedTokens: 50,
        maximumSymbolsPerEntry: 5,
      },
    });

    expect(cold.statistics.includedFiles).toBeGreaterThan(
      warm.statistics.includedFiles,
    );
    expect(REPO_MAP_DEFAULTS.MAP_MUL_NO_FILES).toBe(8);
  });

  it("sanitizes FTS metacharacters from expanded query terms", () => {
    const normalization = new TextQueryNormalizer().normalize({
      workspace: "/repo",
      query: 'find "Login*Form"(handler)',
    });

    const terms = normalization.request?.terms ?? [];
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) {
      expect(term).not.toMatch(/["*^:(){}[\]~\\]/);
    }
  });

  it("weights relative_path higher in BM25 column weights", () => {
    // columns: [unused×3, relative_path, unused, identifiers, content]
    expect(TEXT_INDEX_FTS.BM25_WEIGHTS[3]).toBe(10);
    expect(TEXT_INDEX_FTS.BM25_WEIGHTS[3]).toBeGreaterThan(
      TEXT_INDEX_FTS.BM25_WEIGHTS[5]!,
    );
  });

  it("session source surfaces stale files as preferred re-read candidates", async () => {
    const result = await new HybridRetriever([
      { source: new SessionContextRetrievalSource() },
    ]).retrieve({
      workspace: "workspace",
      query: "re-read dirty buffers",
      rankingContext: {
        openFiles: ["src/Open.ts"],
        staleFiles: ["src/Stale.ts"],
        recentEditFiles: ["src/Recent.ts"],
      },
    });

    const byPath = new Map(
      result.candidates.map((candidate) => [
        candidate.relativePath,
        candidate,
      ]),
    );

    expect(byPath.has("src/Stale.ts")).toBe(true);
    expect(byPath.has("src/Recent.ts")).toBe(true);
    expect(byPath.get("src/Stale.ts")!.fusedScore).toBeGreaterThan(
      byPath.get("src/Recent.ts")!.fusedScore,
    );
    expect(
      byPath.get("src/Stale.ts")!.reasons.some(
        (reason) => reason.type === "session_stale_file",
      ),
    ).toBe(true);
  });

  it("builds ranking context with staleFiles from selection references", () => {
    const context = buildHybridRetrievalRankingContext({
      currentFile: { relativePath: "src/Main.ts" },
      staleFiles: [
        { relativePath: "src/A.ts" },
        { relativePath: "src/B.ts" },
      ],
      recentEditFiles: [{ relativePath: "src/A.ts" }],
    });

    expect(context?.staleFiles).toEqual(["src/A.ts", "src/B.ts"]);
    expect(context?.recentEditFiles).toEqual(["src/A.ts"]);
    expect(context?.currentFile).toBe("src/Main.ts");
  });
});
