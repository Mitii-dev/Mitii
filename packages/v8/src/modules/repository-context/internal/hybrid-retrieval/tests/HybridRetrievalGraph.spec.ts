import assert from "node:assert/strict";
import test from "node:test";
import { HybridRetriever } from "../HybridRetriever";
import { RepoGraphRetrievalSource } from "../sources";
import type {
  RepoGraphEdge,
  RepoGraphNode,
} from "../../../../repository-state/index";
import { baseInput, createGraph } from "./hybridRetrievalHarness";

test(
  "repo graph retrieval returns direct matches and bounded neighbors",
  async () => {
    const nodes:
      RepoGraphNode[] = [
        {
          id:
            "file:auth",
          kind:
            "file",
          fileId:
            "auth",
          rootId:
            "root",
          relativePath:
            "src/auth.ts",
        },
        {
          id:
            "file:database",
          kind:
            "file",
          fileId:
            "database",
          rootId:
            "root",
          relativePath:
            "src/database.ts",
        },
      ];

    const edges:
      RepoGraphEdge[] = [
        {
          id:
            "edge:auth-database",
          type:
            "imports",
          fromNodeId:
            "file:auth",
          toNodeId:
            "file:database",
          weight:
            1,
          evidenceCount:
            1,
          evidence: [
            {
              source:
                "code_index_import",
            },
          ],
          evidenceTruncated:
            false,
        },
      ];

    const graph =
      createGraph(
        nodes,
        edges,
      );

    const retriever =
      new HybridRetriever([
        {
          source:
            new RepoGraphRetrievalSource(
              {
                maximumNeighborsPerAnchor:
                  1,
              },
            ),
        },
      ]);

    const result =
      await retriever.retrieve({
        ...baseInput,
        query:
          "auth handler",
        repoGraph:
          graph,
      });

    assert.deepEqual(
      result.candidates.map(
        (entry) =>
          entry.relativePath,
      ),
      [
        "src/auth.ts",
        "src/database.ts",
      ],
    );
    assert.ok(
      result.candidates[1]
        ?.reasons.some(
          (reason) =>
            reason.type ===
            "graph_import_neighbor",
        ),
    );
  },
);

test(
  "repo graph retrieval expands call blast radius across bounded hops",
  async () => {
    const nodes:
      RepoGraphNode[] = [
        {
          id:
            "file:entry",
          kind:
            "file",
          fileId:
            "entry",
          rootId:
            "root",
          relativePath:
            "src/entry.ts",
        },
        {
          id:
            "file:service",
          kind:
            "file",
          fileId:
            "service",
          rootId:
            "root",
          relativePath:
            "src/service.ts",
        },
        {
          id:
            "file:auth",
          kind:
            "file",
          fileId:
            "auth",
          rootId:
            "root",
          relativePath:
            "src/auth.ts",
        },
        {
          id:
            "symbol:entry",
          kind:
            "symbol",
          symbolId:
            "symbol:entry",
          fileId:
            "entry",
          name:
            "main",
          symbolKind:
            "function",
          startLine:
            1,
        },
        {
          id:
            "symbol:service",
          kind:
            "symbol",
          symbolId:
            "symbol:service",
          fileId:
            "service",
          name:
            "validateSession",
          symbolKind:
            "function",
          startLine:
            1,
        },
        {
          id:
            "symbol:auth",
          kind:
            "symbol",
          symbolId:
            "symbol:auth",
          fileId:
            "auth",
          name:
            "validateJwt",
          symbolKind:
            "function",
          startLine:
            1,
        },
      ];

    const edges:
      RepoGraphEdge[] = [
        {
          id:
            "edge:entry-service",
          type:
            "calls",
          fromNodeId:
            "symbol:entry",
          toNodeId:
            "symbol:service",
          weight:
            1,
          evidenceCount:
            1,
          evidence: [
            {
              source:
                "code_index_reference",
              detail:
                "call",
              line:
                3,
            },
          ],
          evidenceTruncated:
            false,
        },
        {
          id:
            "edge:service-auth",
          type:
            "calls",
          fromNodeId:
            "symbol:service",
          toNodeId:
            "symbol:auth",
          weight:
            1,
          evidenceCount:
            1,
          evidence: [
            {
              source:
                "code_index_reference",
              detail:
                "call",
              line:
                4,
            },
          ],
          evidenceTruncated:
            false,
        },
      ];

    const retriever =
      new HybridRetriever([
        {
          source:
            new RepoGraphRetrievalSource(
              {
                maximumHops: 2,
                maximumNeighborsPerAnchor:
                  4,
              },
            ),
        },
      ]);

    const result =
      await retriever.retrieve({
        ...baseInput,
        query:
          "validateJwt",
        repoGraph:
          createGraph(
            nodes,
            edges,
          ),
      });

    assert.deepEqual(
      result.candidates.map(
        (entry) =>
          entry.relativePath,
      ),
      [
        "src/auth.ts",
        "src/service.ts",
        "src/entry.ts",
      ],
    );
    assert.ok(
      result.candidates
        .slice(1)
        .every((entry) =>
          entry.reasons.some(
            (reason) =>
              reason.type ===
              "graph_call_neighbor",
          ),
        ),
    );
  },
);
