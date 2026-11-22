import {
  RetrievalCandidateKeyBuilder,
} from "../RetrievalCandidateKeyBuilder";

import {
  addGraphCandidate,
  candidateMatchesScope,
  toGraphCandidate,
} from "./RepoGraphCandidates";

import {
  describeNeighborMatch,
  scoreNeighbor,
} from "./RepoGraphScoring";

import type {
  RepoGraphAnchorMatch,
  RepoGraphFileIndex,
} from "./RepoGraphCandidates";

import type {
  RepoGraphEdge,
  RepoGraphEdgeType,
  RepoGraphNode,
} from "../../../../repository-state/index";

import type {
  NormalizedHybridRetrievalRequest,
  RetrievalCandidate,
} from "../types";

interface AdjacentEdge {
  readonly nodeId: string;
  readonly edge: RepoGraphEdge;
}

export interface RepoGraphBlastRadiusInput {
  readonly anchors: readonly RepoGraphAnchorMatch[];
  readonly edges: readonly RepoGraphEdge[];
  readonly nodeById: ReadonlyMap<string, RepoGraphNode>;
  readonly fileByFileId: RepoGraphFileIndex;
  readonly request: NormalizedHybridRetrievalRequest;
  readonly candidateByKey: Map<string, RetrievalCandidate>;
  readonly edgeTypes: readonly RepoGraphEdgeType[];
  readonly maximumHops: number;
  readonly maximumNeighborsPerAnchor: number;
  readonly keyBuilder: RetrievalCandidateKeyBuilder;
}

/** Breadth-first expands anchors across retrieval edges and records neighbor candidates. */
export function expandBlastRadius(
  input: RepoGraphBlastRadiusInput,
): void {
  const adjacency = createRetrievalAdjacency(
    input.edges,
    input.nodeById,
    input.edgeTypes,
  );

  for (const anchor of input.anchors) {
    let acceptedNeighbors = 0;
    const visited = new Set([anchor.nodeId]);
    const queue: { nodeId: string; depth: number }[] = [
      { nodeId: anchor.nodeId, depth: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift();

      if (!current) {
        break;
      }

      if (current.depth >= input.maximumHops) {
        continue;
      }

      const neighbors =
        adjacency.get(current.nodeId) ?? [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.nodeId)) {
          continue;
        }

        visited.add(neighbor.nodeId);

        const nextDepth = current.depth + 1;
        queue.push({
          nodeId: neighbor.nodeId,
          depth: nextDepth,
        });

        if (
          acceptedNeighbors >=
          input.maximumNeighborsPerAnchor
        ) {
          continue;
        }

        const node = input.nodeById.get(
          neighbor.nodeId,
        );

        if (!node) {
          continue;
        }

        const candidate = toGraphCandidate(
          node,
          input.fileByFileId,
          scoreNeighbor(
            anchor.candidate.sourceScore,
            nextDepth,
          ),
          describeNeighborMatch(
            neighbor.edge,
            nextDepth,
          ),
        );

        if (
          !candidate ||
          !candidateMatchesScope(
            candidate,
            input.request,
          )
        ) {
          continue;
        }

        acceptedNeighbors += 1;
        addGraphCandidate(
          input.candidateByKey,
          candidate,
          input.keyBuilder,
        );
      }
    }
  }
}

function createRetrievalAdjacency(
  edges: readonly RepoGraphEdge[],
  nodeById: ReadonlyMap<string, RepoGraphNode>,
  edgeTypes: readonly RepoGraphEdgeType[],
): ReadonlyMap<string, readonly AdjacentEdge[]> {
  const adjacency = new Map<string, AdjacentEdge[]>();

  for (const edge of edges) {
    if (
      !edgeTypes.includes(edge.type) ||
      !nodeById.has(edge.fromNodeId) ||
      !nodeById.has(edge.toNodeId)
    ) {
      continue;
    }

    addAdjacentEdge(
      adjacency,
      edge.fromNodeId,
      edge.toNodeId,
      edge,
    );
    addAdjacentEdge(
      adjacency,
      edge.toNodeId,
      edge.fromNodeId,
      edge,
    );
  }

  for (const neighbors of adjacency.values()) {
    neighbors.sort(
      (left, right) =>
        edgeTypeOrder(edgeTypes, left.edge.type) -
          edgeTypeOrder(
            edgeTypes,
            right.edge.type,
          ) ||
        left.nodeId.localeCompare(right.nodeId) ||
        left.edge.id.localeCompare(right.edge.id),
    );
  }

  return adjacency;
}

function addAdjacentEdge(
  adjacency: Map<string, AdjacentEdge[]>,
  fromNodeId: string,
  toNodeId: string,
  edge: RepoGraphEdge,
): void {
  const neighbors =
    adjacency.get(fromNodeId) ?? [];

  neighbors.push({ nodeId: toNodeId, edge });
  adjacency.set(fromNodeId, neighbors);
}

function edgeTypeOrder(
  edgeTypes: readonly RepoGraphEdgeType[],
  edgeType: RepoGraphEdgeType,
): number {
  const index = edgeTypes.indexOf(edgeType);

  return index >= 0
    ? index
    : Number.MAX_SAFE_INTEGER;
}
