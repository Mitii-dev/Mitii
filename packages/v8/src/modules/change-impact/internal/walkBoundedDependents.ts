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
}

/**
 * Bounded reverse-dependent BFS.
 * `maximumAffectedNodes` caps both accepted report nodes and further expansion.
 */
export function walkBoundedDependents<TEdge extends RepoGraphEdge>(params: {
  seedNodeIds: readonly string[];
  maximumHops: number;
  maximumAffectedNodes: number;
  adjacency: ReadonlyMap<string, readonly BoundedWalkNeighbor<TEdge>[]>;
  nodeExists: (nodeId: string) => boolean;
  score: (edge: TEdge, hop: number) => number;
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
  const queue = params.seedNodeIds.map((nodeId) => ({ nodeId, hop: 0 }));
  const visits: BoundedWalkVisit<TEdge>[] = [];
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

    if (current.hop >= params.maximumHops) {
      if (neighbors.length > 0) {
        truncated = true;
        reasonCodes.add("hop_limit_reached");
      }
      continue;
    }

    for (const neighbor of neighbors) {
      if (seedIds.has(neighbor.nodeId) || visited.has(neighbor.nodeId)) {
        continue;
      }
      if (!params.nodeExists(neighbor.nodeId)) continue;

      if (accepted.size >= params.maximumAffectedNodes) {
        truncated = true;
        reasonCodes.add("node_limit_reached");
        break;
      }

      visited.add(neighbor.nodeId);
      const hop = current.hop + 1;
      accepted.add(neighbor.nodeId);
      visits.push({
        nodeId: neighbor.nodeId,
        hop,
        viaEdge: neighbor.edge,
        score: params.score(neighbor.edge, hop),
      });
      // Only expand nodes that were accepted under the budget.
      queue.push({ nodeId: neighbor.nodeId, hop });
    }
  }

  visits.sort(params.compareVisits);
  return {
    visits,
    truncated,
    reasonCodes: [...reasonCodes],
    visitedCount: visited.size,
  };
}
