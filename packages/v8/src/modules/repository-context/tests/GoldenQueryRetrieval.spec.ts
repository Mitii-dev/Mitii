import { describe, expect, it } from "vitest";

import { HybridRetriever } from "../internal/hybrid-retrieval/HybridRetriever";
import { RepoGraphRetrievalSource } from "../internal/hybrid-retrieval/sources";
import { RepositoryContextPipeline } from "../pipeline/context-pipeline/RepositoryContextPipeline";
import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
} from "../internal/context-assembly/types";
import type {
  ContextSelectionInput,
  ContextSelectionResult,
} from "../internal/context-selection/types";
import type {
  HybridRetrievalInput,
  HybridRetrievalResult,
} from "../internal/hybrid-retrieval/types";
import type {
  RepositoryStateDescriptor,
  RepositoryStateReference,
  WorkspaceSnapshot,
} from "../../repository-state";
import type { RepoGraph, RepoGraphEdge, RepoGraphNode } from "../../repository-state";

const SNAPSHOT_ID = "a".repeat(64);
const STATE_TOKEN = "b".repeat(64);

describe("golden query retrieval", () => {
  it("must include graph neighbors of a git-dirty auth file for a regression query", async () => {
    const retriever = new HybridRetriever([
      {
        source: new RepoGraphRetrievalSource({
          maximumHops: 1,
          maximumNeighborsPerAnchor: 4,
        }),
      },
    ]);

    const result = await retriever.retrieve({
      workspace: "workspace",
      query: "Fix the authentication regression in session handling",
      anchorFilePaths: ["src/auth/session.ts"],
      repoGraph: createAuthGraph(),
    });

    const paths = result.candidates.map((candidate) => candidate.relativePath);
    expect(paths).toContain("src/auth/session.ts");
    expect(paths).toContain("src/auth/token.ts");
    expect(
      result.candidates.some((candidate) =>
        candidate.reasons.some((reason) => reason.type === "graph_file_anchor"),
      ),
    ).toBe(true);
  });

  it("pipeline forwards editor and git references as graph anchors", async () => {
    let retrievalInput: HybridRetrievalInput | undefined;
    const pipeline = new RepositoryContextPipeline({
      stateResolver: {
        resolve: async (_reference: RepositoryStateReference) => ({
          status: "resolved" as const,
          artifacts: {
            descriptor: descriptor(),
            snapshot,
          },
        }),
      },
      retriever: {
        retrieve: async (input) => {
          retrievalInput = input;
          return emptyRetrieval(input.query);
        },
      },
      selector: {
        select: (input) => emptySelection(input),
      },
      assembler: {
        assemble: async (input) => emptyAssembly(input),
      },
    });

    await pipeline.execute({
      state: {
        workspaceId: "workspace",
        stateToken: STATE_TOKEN,
      },
      query: "Fix the authentication regression",
      mode: "agent",
      references: {
        currentFile: { relativePath: "src/auth/session.ts" },
        gitDiffFiles: [{ relativePath: "src/auth/token.ts" }],
      },
    });

    expect(retrievalInput?.anchorFilePaths).toEqual([
      "src/auth/session.ts",
      "src/auth/token.ts",
    ]);
    expect(retrievalInput?.filePaths).toBeUndefined();
  });
});

function createAuthGraph(): RepoGraph {
  const nodes: RepoGraphNode[] = [
    fileNode("session", "src/auth/session.ts"),
    fileNode("token", "src/auth/token.ts"),
    fileNode("readme", "README.md"),
    {
      id: "symbol:session",
      kind: "symbol",
      symbolId: "symbol:session",
      fileId: "session",
      name: "authenticate",
      symbolKind: "function",
      startLine: 1,
    },
    {
      id: "symbol:token",
      kind: "symbol",
      symbolId: "symbol:token",
      fileId: "token",
      name: "signToken",
      symbolKind: "function",
      startLine: 1,
    },
  ];
  const edges: RepoGraphEdge[] = [
    {
      id: "edge:session-token",
      type: "imports",
      fromNodeId: "file:session",
      toNodeId: "file:token",
      weight: 1,
      evidenceCount: 1,
      evidence: [{ source: "code_index_import" }],
      evidenceTruncated: false,
    },
  ];
  return {
    schemaVersion: 1,
    workspaceSnapshotId: "snapshot-1",
    codeIndexChangeToken: "change-1",
    nodes,
    edges,
    warnings: [],
    statistics: {
      availableFiles: 3,
      indexedFiles: 3,
      projectNodes: 0,
      fileNodes: 3,
      symbolNodes: 2,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: 1,
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
      durationMs: 0,
    },
    status: "complete",
    generatedAt: new Date(0).toISOString(),
  };
}

function fileNode(id: string, relativePath: string): RepoGraphNode {
  return {
    id: `file:${id}`,
    kind: "file",
    fileId: id,
    rootId: "root",
    relativePath,
  };
}

const snapshot: WorkspaceSnapshot = {
  schemaVersion: 1,
  snapshotId: SNAPSHOT_ID,
  roots: [{ id: "root", name: "root", kind: "directory" }],
  entries: [],
  warnings: [],
  statistics: {
    files: 0,
    directories: 0,
    symbolicLinks: 0,
    otherEntries: 0,
    ignoredEntries: 0,
    warnings: 0,
    durationMs: 0,
  },
  limits: {
    maximumDepth: 10,
    maximumFiles: 100,
    maximumDirectories: 100,
    timeoutMs: 1_000,
    followSymbolicLinks: false,
  },
  status: "complete",
  generatedAt: "2026-07-25T12:00:00.000Z",
};

function descriptor(): RepositoryStateDescriptor {
  return {
    schemaVersion: 1,
    workspaceId: "workspace",
    stateToken: STATE_TOKEN,
    snapshotId: SNAPSHOT_ID,
    roots: [
      {
        rootId: "root",
        projectCatalogRevision: "catalog-1",
        codeIndexRevision: "index-1",
        textIndexRevision: "text-1",
        capabilities: [
          { capability: "catalog", status: "ready" },
          { capability: "codeIndex", status: "ready" },
          { capability: "textIndex", status: "ready" },
        ],
      },
    ],
    readiness: "ready",
    reasons: [],
    generatedAt: "2026-07-25T12:00:00.000Z",
    scanCompleteness: "complete",
    cleanupAllowed: true,
  };
}

function emptyRetrieval(query: string): HybridRetrievalResult {
  return {
    schemaVersion: 1,
    query,
    status: "empty",
    candidates: [],
    sourceReports: [],
    warnings: [],
    truncated: false,
    statistics: {
      configuredSources: 0,
      attemptedSources: 0,
      successfulSources: 0,
      failedSources: 0,
      skippedSources: 0,
      sourceCandidates: 0,
      uniqueCandidates: 0,
      duplicateCandidatesRemoved: 0,
      returnedCandidates: 0,
    },
  };
}

function emptySelection(input: ContextSelectionInput): ContextSelectionResult {
  return {
    schemaVersion: 1,
    query: input.query,
    mode: input.mode ?? "ask",
    breadth: input.breadth ?? "balanced",
    status: "empty",
    items: [],
    dropped: [],
    warnings: [],
    budget: {
      maximumTokens: 1_000,
      usedTokens: 0,
      remainingTokens: 1_000,
      maximumItems: 10,
      maximumFiles: 10,
      maximumItemsPerFile: 2,
    },
    statistics: {
      retrievedCandidates: 0,
      synthesizedReferences: 0,
      consideredCandidates: 0,
      selectedItems: 0,
      droppedItems: 0,
      selectedFiles: 0,
      selectedRoots: 0,
      requiredItems: 0,
      preferredItems: 0,
      supplementaryItems: 0,
      fullFileItems: 0,
      exactRangeItems: 0,
      targetedExcerptItems: 0,
      fileOutlineItems: 0,
      symbolSignatureItems: 0,
    },
  };
}

function emptyAssembly(input: ContextAssemblyInput): ContextAssemblyResult {
  return {
    schemaVersion: 1,
    workspaceSnapshotId: input.snapshot.snapshotId,
    selectionStatus: input.selection.status,
    status: "empty",
    blocks: [],
    dropped: [],
    warnings: [],
    budget: {
      allocatedTokens: 0,
      usedTokens: 0,
      remainingTokens: 0,
    },
    statistics: {
      selectedItems: 0,
      attemptedItems: 0,
      assembledBlocks: 0,
      droppedBlocks: 0,
      loadedFiles: 0,
      loadedRoots: 0,
      truncatedBlocks: 0,
      fallbackBlocks: 0,
      redactedBlocks: 0,
      redactionCount: 0,
      inputCharacters: 0,
      outputCharacters: 0,
    },
  };
}
