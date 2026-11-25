import { describe, expect, it } from "vitest";
import { HybridRetriever } from "../HybridRetriever";
import { RepoGraphRetrievalSource } from "../sources";
import type {
  RepoGraphEdge,
  RepoGraphNode,
} from "../../../../repository-state/index";
import { baseInput, createGraph } from "./hybridRetrievalHarness";

const fileNode = (id: string, relativePath: string): RepoGraphNode => ({
  id: `file:${id}`,
  kind: "file",
  fileId: id,
  rootId: "root",
  relativePath,
});

const symbolNode = (id: string, name: string): RepoGraphNode => ({
  id: `symbol:${id}`,
  kind: "symbol",
  symbolId: `symbol:${id}`,
  fileId: id,
  name,
  symbolKind: "function",
  startLine: 1,
});

const callEdge = (
  id: string,
  from: string,
  to: string,
  line: number,
): RepoGraphEdge => ({
  id,
  type: "calls",
  fromNodeId: from,
  toNodeId: to,
  weight: 1,
  evidenceCount: 1,
  evidence: [{ source: "code_index_reference", detail: "call", line }],
  evidenceTruncated: false,
});

describe("HybridRetriever repo graph source", () => {
  it("returns direct matches and bounded neighbors", async () => {
    const nodes = [
      fileNode("auth", "src/auth.ts"),
      fileNode("database", "src/database.ts"),
    ];
    const edges: RepoGraphEdge[] = [
      {
        id: "edge:auth-database",
        type: "imports",
        fromNodeId: "file:auth",
        toNodeId: "file:database",
        weight: 1,
        evidenceCount: 1,
        evidence: [{ source: "code_index_import" }],
        evidenceTruncated: false,
      },
    ];

    const retriever = new HybridRetriever([
      {
        source: new RepoGraphRetrievalSource({ maximumNeighborsPerAnchor: 1 }),
      },
    ]);

    const result = await retriever.retrieve({
      ...baseInput,
      query: "auth handler",
      repoGraph: createGraph(nodes, edges),
    });

    expect(result.candidates.map((entry) => entry.relativePath)).toEqual([
      "src/auth.ts",
      "src/database.ts",
    ]);
    expect(
      result.candidates[1]?.reasons.some(
        (reason) => reason.type === "graph_import_neighbor",
      ),
    ).toBe(true);
  });

  it("expands call blast radius across bounded hops", async () => {
    const nodes = [
      fileNode("entry", "src/entry.ts"),
      fileNode("service", "src/service.ts"),
      fileNode("auth", "src/auth.ts"),
      symbolNode("entry", "main"),
      symbolNode("service", "validateSession"),
      symbolNode("auth", "validateJwt"),
    ];
    const edges = [
      callEdge("edge:entry-service", "symbol:entry", "symbol:service", 3),
      callEdge("edge:service-auth", "symbol:service", "symbol:auth", 4),
    ];

    const retriever = new HybridRetriever([
      {
        source: new RepoGraphRetrievalSource({
          maximumHops: 2,
          maximumNeighborsPerAnchor: 4,
        }),
      },
    ]);

    const result = await retriever.retrieve({
      ...baseInput,
      query: "validateJwt",
      repoGraph: createGraph(nodes, edges),
    });

    expect(result.candidates.map((entry) => entry.relativePath)).toEqual([
      "src/auth.ts",
      "src/service.ts",
      "src/entry.ts",
    ]);
    expect(
      result.candidates
        .slice(1)
        .every((entry) =>
          entry.reasons.some((reason) => reason.type === "graph_call_neighbor"),
        ),
    ).toBe(true);
  });
});
