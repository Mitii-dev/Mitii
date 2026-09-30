import { describe, expect, it } from "vitest";

import type { RepoGraphEdge } from "../../../repository-state";
import {
  collapseChainPrefixes,
  collectBoundedChains,
} from "../../internal/collectBoundedChains";
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
    expect(walked.visitedCount).toBe(1 + maximumAffectedNodes);
    expect(walked.visits.every((visit) => hop1.includes(visit.nodeId))).toBe(true);
    expect(walked.visits[0]?.pathNodeIds[0]).toBe("seed");
  });

  it("retains the better score when a node is reached again at the same hop", () => {
    const adjacency = new Map<string, Array<{ nodeId: string; edge: RepoGraphEdge }>>([
      [
        "seed",
        [
          { nodeId: "target", edge: edge("e-weak", "seed", "target", 1) },
          { nodeId: "target", edge: edge("e-strong", "seed", "target", 10) },
        ],
      ],
    ]);

    const walked = walkBoundedDependents({
      seedNodeIds: ["seed"],
      maximumHops: 1,
      maximumAffectedNodes: 10,
      adjacency,
      nodeExists: () => true,
      score: (visitEdge, hop) => visitEdge.weight / hop,
      compareVisits: (left, right) => left.nodeId.localeCompare(right.nodeId),
    });

    expect(walked.visits).toHaveLength(1);
    expect(walked.visits[0]?.viaEdge.id).toBe("e-strong");
    expect(walked.visits[0]?.score).toBe(10);
    expect(walked.visits[0]?.pathNodeIds).toEqual(["seed", "target"]);
  });
});

describe("collectBoundedChains", () => {
  it("enumerates branching paths up to maximumPaths", () => {
    const adjacency = new Map<string, Array<{ nodeId: string; edge: RepoGraphEdge }>>([
      [
        "seed",
        [
          { nodeId: "a", edge: edge("e1", "seed", "a") },
          { nodeId: "b", edge: edge("e2", "seed", "b") },
        ],
      ],
      ["a", [{ nodeId: "c", edge: edge("e3", "a", "c") }]],
      ["b", [{ nodeId: "c", edge: edge("e4", "b", "c") }]],
    ]);

    const collected = collectBoundedChains({
      seedNodeIds: ["seed"],
      maximumHops: 2,
      maximumPaths: 10,
      adjacency,
      nodeExists: () => true,
      score: () => 1,
    });

    expect(collected.truncated).toBe(false);
    expect(collected.chains.map((chain) => chain.nodeIds.join(">")).sort()).toEqual([
      "seed>a>c",
      "seed>b>c",
    ]);
  });

  it("reports path_limit_reached separately from node walks", () => {
    const adjacency = new Map<string, Array<{ nodeId: string; edge: RepoGraphEdge }>>([
      [
        "seed",
        Array.from({ length: 8 }, (_, index) => ({
          nodeId: `n${index}`,
          edge: edge(`e${index}`, "seed", `n${index}`),
        })),
      ],
    ]);

    const collected = collectBoundedChains({
      seedNodeIds: ["seed"],
      maximumHops: 1,
      maximumPaths: 3,
      adjacency,
      nodeExists: () => true,
      score: () => 1,
    });

    expect(collected.truncated).toBe(true);
    expect(collected.reasonCodes).toContain("path_limit_reached");
    expect(collected.chains.length).toBeLessThanOrEqual(3);
  });
});

describe("collapseChainPrefixes", () => {
  it("groups shared prefixes Goose-style", () => {
    expect(
      collapseChainPrefixes([
        ["core", "caller", "routeA"],
        ["core", "caller", "routeB"],
        ["core", "other"],
      ]),
    ).toEqual([
      "core → caller",
      "  → routeA",
      "  → routeB",
      "core → other",
    ]);
  });
});

function edge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  weight = 1,
): RepoGraphEdge {
  return {
    id,
    type: "imports",
    fromNodeId,
    toNodeId,
    weight,
    evidenceCount: 1,
    evidence: [],
  };
}
