import { describe, expect, it } from "vitest";

import type { RepoGraphEdge } from "../../../repository-state";
import { walkBoundedDependents } from "../../internal/walkBoundedDependents";

describe("walkBoundedDependents", () => {
  it("does not visit or enqueue nodes beyond maximumAffectedNodes", () => {
    const seed = "seed";
    const adjacency = new Map<string, Array<{ nodeId: string; edge: RepoGraphEdge }>>();

    const hop1 = Array.from({ length: 20 }, (_, index) => `n${index}`);
    adjacency.set(
      seed,
      hop1.map((nodeId, index) => ({
        nodeId,
        edge: edge(`e-seed-${index}`, seed, nodeId),
      })),
    );

    for (const nodeId of hop1) {
      const children = Array.from({ length: 10 }, (_, index) => `${nodeId}-c${index}`);
      adjacency.set(
        nodeId,
        children.map((childId, index) => ({
          nodeId: childId,
          edge: edge(`e-${nodeId}-${index}`, nodeId, childId),
        })),
      );
    }

    const maximumAffectedNodes = 3;
    const walked = walkBoundedDependents({
      seedNodeIds: [seed],
      maximumHops: 6,
      maximumAffectedNodes,
      adjacency,
      nodeExists: () => true,
      score: () => 1,
      compareVisits: (left, right) => left.nodeId.localeCompare(right.nodeId),
    });

    expect(walked.truncated).toBe(true);
    expect(walked.reasonCodes).toContain("node_limit_reached");
    expect(walked.visits).toHaveLength(maximumAffectedNodes);
    // Seeds + accepted only. Old bug visited all hop-1 (+ deeper) before accepting.
    expect(walked.visitedCount).toBe(1 + maximumAffectedNodes);
    expect(walked.visits.every((visit) => hop1.includes(visit.nodeId))).toBe(true);
  });
});

function edge(id: string, fromNodeId: string, toNodeId: string): RepoGraphEdge {
  return {
    id,
    type: "imports",
    fromNodeId,
    toNodeId,
    weight: 1,
    evidenceCount: 1,
    evidence: [],
  };
}
