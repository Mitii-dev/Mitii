import { describe, expect, it } from "vitest";

import { RepoGraphEdgeAccumulator } from "../internal/repo-graph/RepoGraphEdgeAccumulator";
import { loadConfigExtendsEdges } from "../internal/repo-graph/loadConfigExtendsEdges";
import type { RepoGraphFileNode } from "../internal/repo-graph/types";

function file(id: string, relativePath: string): RepoGraphFileNode {
  return {
    id,
    kind: "file",
    fileId: id,
    rootId: "workspace",
    relativePath,
  };
}

describe("loadConfigExtendsEdges", () => {
  it("adds depends_on from tsconfig extends to the base config file", async () => {
    const edges = new RepoGraphEdgeAccumulator({
      maximumEdges: 100,
      maximumEvidencePerEdge: 4,
    });
    const result = await loadConfigExtendsEdges({
      fileNodes: [
        file("file:base", "tsconfig.base.json"),
        file("file:app", "packages/app/tsconfig.json"),
      ],
      edges,
      readWorkspaceText: async ({ relativePath }) => {
        if (relativePath === "packages/app/tsconfig.json") {
          return JSON.stringify({ extends: "../../tsconfig.base.json" });
        }
        return "{}";
      },
    });

    expect(result.edgesAdded).toBe(1);
    const edge = edges.result().edges[0];
    expect(edge?.type).toBe("depends_on");
    expect(edge?.fromNodeId).toBe("file:app");
    expect(edge?.toNodeId).toBe("file:base");
    expect(edge?.evidence[0]?.source).toBe("config_file");
  });

  it("no-ops without a text reader", async () => {
    const edges = new RepoGraphEdgeAccumulator({
      maximumEdges: 100,
      maximumEvidencePerEdge: 4,
    });
    const result = await loadConfigExtendsEdges({
      fileNodes: [file("file:app", "tsconfig.json")],
      edges,
    });
    expect(result.edgesAdded).toBe(0);
    expect(edges.result().edges).toHaveLength(0);
  });
});
