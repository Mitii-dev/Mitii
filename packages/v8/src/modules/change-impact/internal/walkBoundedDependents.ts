import type { ChangeImpactReasonCode } from "../contracts";
import type { RepoGraphEdge } from "../../repository-state";

export interface BoundedWalkNeighbor<TEdge> {
  nodeId: string;
  edge: TEdge;
}

export interface BoundedWalkVisit<TEdge> {
  nodeId: string;
  hop: number;
  viaEdge: TEdge;
  score: number;
  /** Best-path node ids from a seed (exclusive) through this node (inclusive). */
  pathNodeIds: string[];
}

/**
 * Bounded BFS with best-score retention and best-path parent tracking.
 * First reach sets hop (unweighted). Revisits at the same hop may replace
 * the recorded via-edge/score when the new score is better; they do not
 * re-enqueue expansion. `maximumAffectedNodes` caps accepted report nodes.
 */
export function walkBoundedDependents<TEdge extends RepoGraphEdge>(params: {
  seedNodeIds: readonly string[];
  maximumHops: number;
  maximumAffectedNodes: number;
  adjacency: ReadonlyMap<string, readonly BoundedWalkNeighbor<TEdge>[]>;
  nodeExists: (nodeId: string) => boolean;
  score: (edge: TEdge, hop: number, nodeId: string) => number;
  compareVisits: (
    left: BoundedWalkVisit<TEdge>,
    right: BoundedWalkVisit<TEdge>,
  ) => number;
}): {
  visits: BoundedWalkVisit<TEdge>[];
  truncated: boolean;
  reasonCodes: ChangeImpactReasonCode[];
  /** Seeds + accepted (+ any nodes marked visited). Used to prove expansion bounds. */
  visitedCount: number;
} {
  const seedIds = new Set(params.seedNodeIds);
  const visited = new Set(params.seedNodeIds);
  const accepted = new Set<string>();
  const visitByNodeId = new Map<string, BoundedWalkVisit<TEdge>>();
  const pathByNodeId = new Map<string, string[]>();
  for (const seedId of params.seedNodeIds) {
    pathByNodeId.set(seedId, [seedId]);
  }
  const queue = params.seedNodeIds.map((nodeId) => ({ nodeId, hop: 0 }));
  const reasonCodes = new Set<ChangeImpactReasonCode>();
  let truncated = false;

  while (queue.length > 0) {
    // Bound runtime/memory: once the report is full, stop expanding entirely.
    if (accepted.size >= params.maximumAffectedNodes) {
      truncated = true;
      reasonCodes.add("node_limit_reached");
      break;
    }

    const current = queue.shift();
    if (!current) break;
    const neighbors = params.adjacency.get(current.nodeId) ?? [];
    const parentPath = pathByNodeId.get(current.nodeId) ?? [current.nodeId];

    if (current.hop >= params.maximumHops) {
      if (neighbors.length > 0) {
        truncated = true;
        reasonCodes.add("hop_limit_reached");
      }
      continue;
    }

    for (const neighbor of neighbors) {
      if (seedIds.has(neighbor.nodeId)) {
        continue;
      }
      if (!params.nodeExists(neighbor.nodeId)) continue;

      const hop = current.hop + 1;
      const score = params.score(neighbor.edge, hop, neighbor.nodeId);
      const nextPath = [...parentPath, neighbor.nodeId];

      const existing = visitByNodeId.get(neighbor.nodeId);
      if (existing) {
        // Same hop (or unexpectedly lower): keep the stronger score/edge.
        if (
          hop < existing.hop ||
          (hop === existing.hop && score > existing.score)
        ) {
          existing.hop = hop;
          existing.viaEdge = neighbor.edge;
          existing.score = score;
          existing.pathNodeIds = nextPath;
          pathByNodeId.set(neighbor.nodeId, nextPath);
        }
        continue;
      }

      if (accepted.size >= params.maximumAffectedNodes) {
        truncated = true;
        reasonCodes.add("node_limit_reached");
        break;
      }

      visited.add(neighbor.nodeId);
      accepted.add(neighbor.nodeId);
      pathByNodeId.set(neighbor.nodeId, nextPath);
      const visit: BoundedWalkVisit<TEdge> = {
        nodeId: neighbor.nodeId,
        hop,
        viaEdge: neighbor.edge,
        score,
        pathNodeIds: nextPath,
      };
      visitByNodeId.set(neighbor.nodeId, visit);
      // Only expand nodes that were accepted under the budget.
      queue.push({ nodeId: neighbor.nodeId, hop });
    }
  }

  const visits = [...visitByNodeId.values()];
  visits.sort(params.compareVisits);
  return {
    visits,
    truncated,
    reasonCodes: [...reasonCodes],
    visitedCount: visited.size,
  };
}
