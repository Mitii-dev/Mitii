import type {
  NormalizedHybridRetrievalRequest,
  RetrievalCandidate,
  RetrievalSource,
  RetrievalSourceContext,
  RetrievalSourceResult,
} from "../types";
import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphNode,
} from "../../../../repository-state/index";
import type { RepoMap } from "../../../../repository-state/index";

export class StaticRetrievalSource
  implements RetrievalSource
{
  public constructor(
    public readonly id: string,
    private readonly result:
      RetrievalSourceResult,
    private readonly available = true,
  ) {}

  public canRetrieve(
    _request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    return this.available;
  }

  public async retrieve(
    _request:
      NormalizedHybridRetrievalRequest,
    _context?:
      RetrievalSourceContext,
  ): Promise<RetrievalSourceResult> {
    return this.result;
  }
}

export class FailingRetrievalSource
  implements RetrievalSource
{
  public constructor(
    public readonly id: string,
    private readonly phase:
      "capability" |
      "retrieve" =
      "retrieve",
  ) {}

  public canRetrieve(
    _request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    if (
      this.phase ===
      "capability"
    ) {
      throw new Error(
        "Capability check failed.",
      );
    }

    return true;
  }

  public async retrieve(
    _request:
      NormalizedHybridRetrievalRequest,
  ): Promise<RetrievalSourceResult> {
    throw new Error(
      "Source retrieval failed.",
    );
  }
}

export const candidate = (
  relativePath: string,
  chunkId: string,
  sourceScore: number,
): RetrievalCandidate => ({
  entityKind:
    "chunk",
  rootId:
    "root",
  relativePath,
  chunkId,
  sourceScore,
  reasons: [
    {
      type:
        "lexical_match",
      evidence:
        `Matched ${relativePath}.`,
    },
  ],
});

export const complete = (
  candidates:
    RetrievalCandidate[],
): RetrievalSourceResult => ({
  status:
    "complete",
  candidates,
  truncated:
    false,
  warnings: [],
});

export const baseInput = {
  workspace:
    "workspace",
  query:
    "find authentication handler",
} as const;

export function createGraph(
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
        nodes.filter(
          (node) =>
            node.kind === "file",
        ).length,
      indexedFiles:
        nodes.filter(
          (node) =>
            node.kind === "file",
        ).length,
      projectNodes:
        nodes.filter(
          (node) =>
            node.kind ===
            "project",
        ).length,
      fileNodes:
        nodes.filter(
          (node) =>
            node.kind === "file",
        ).length,
      symbolNodes:
        nodes.filter(
          (node) =>
            node.kind ===
            "symbol",
        ).length,
      containsEdges:
        0,
      declaresEdges:
        0,
      importEdges:
        edges.filter(
          (edge) =>
            edge.type === "imports",
        ).length,
      callEdges:
        edges.filter(
          (edge) =>
            edge.type === "calls",
        ).length,
      referenceEdges:
        edges.filter(
          (edge) =>
            edge.type ===
            "references",
        ).length,
      projectRelationshipEdges:
        0,
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

export function repoMapEntry(
  relativePath: string,
  score: number,
): RepoMap["entries"][number] {
  return {
    file: {
      id:
        relativePath,
      rootId:
        "root",
      relativePath,
    },
    symbols: [],
    score,
    pageRank:
      0,
    inboundImportCount:
      0,
    outboundImportCount:
      0,
    inboundReferenceCount:
      0,
    outboundReferenceCount:
      0,
    reasons: [
      {
        type:
          "query_match",
        score,
        evidence:
          `Matched ${relativePath}.`,
      },
    ],
  };
}
