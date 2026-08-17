import assert from "node:assert/strict";
import test from "node:test";

import {
  HybridRetrievalFactory,
} from "../HybridRetrievalFactory";

import {
  HybridRetriever,
} from "../HybridRetriever";

import {
  RepoGraphRetrievalSource,
  RepoMapRetrievalSource,
} from "../sources";

import type {
  NormalizedHybridRetrievalRequest,
  RetrievalCandidate,
  RetrievalReranker,
  RetrievalSource,
  RetrievalSourceContext,
  RetrievalSourceResult,
} from "../types";

import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphNode,
} from "../../../../repository-state/index";

import type {
  RepoMap,
} from "../../../../repository-state/index";

class StaticRetrievalSource
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

class FailingRetrievalSource
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

const candidate = (
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

const complete = (
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

const baseInput = {
  workspace:
    "workspace",
  query:
    "find authentication handler",
} as const;

test(
  "weighted RRF rewards candidates found by multiple sources",
  async () => {
    const shared =
      candidate(
        "src/auth.ts",
        "auth",
        0.8,
      );

    const retriever =
      new HybridRetriever([
        {
          source:
            new StaticRetrievalSource(
              "lexical",
              complete([
                shared,
                candidate(
                  "src/only-text.ts",
                  "text",
                  1,
                ),
              ]),
            ),
        },
        {
          source:
            new StaticRetrievalSource(
              "semantic",
              complete([
                {
                  ...shared,
                  sourceScore:
                    0.7,
                  reasons: [
                    {
                      type:
                        "semantic_match",
                      evidence:
                        "Semantic match.",
                    },
                  ],
                },
              ]),
            ),
        },
      ]);

    const result =
      await retriever.retrieve(
        baseInput,
      );

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.candidates[0]
        ?.relativePath,
      "src/auth.ts",
    );
    assert.equal(
      result.candidates[0]
        ?.matchedSourceCount,
      2,
    );
    assert.equal(
      result.candidates[0]
        ?.contributions.length,
      2,
    );
    assert.equal(
      result.statistics
        .duplicateCandidatesRemoved,
      1,
    );
  },
);

test(
  "best-effort retrieval returns partial output when one source fails",
  async () => {
    const retriever =
      new HybridRetriever([
        {
          source:
            new StaticRetrievalSource(
              "working",
              complete([
                candidate(
                  "src/a.ts",
                  "a",
                  1,
                ),
              ]),
            ),
        },
        {
          source:
            new FailingRetrievalSource(
              "broken",
            ),
        },
      ]);

    const result =
      await retriever.retrieve(
        baseInput,
      );

    assert.equal(
      result.status,
      "partial",
    );
    assert.equal(
      result.candidates.length,
      1,
    );
    assert.equal(
      result.statistics
        .failedSources,
      1,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "source_failed",
      ),
    );
  },
);

test(
  "required-source policy produces an explicit failed result",
  async () => {
    const retriever =
      new HybridRetriever(
        [
          {
            source:
              new StaticRetrievalSource(
                "working",
                complete([
                  candidate(
                    "src/a.ts",
                    "a",
                    1,
                  ),
                ]),
              ),
          },
          {
            source:
              new FailingRetrievalSource(
                "required",
              ),
            required:
              true,
          },
        ],
        {
          failureMode:
            "required_sources",
        },
      );

    const result =
      await retriever.retrieve(
        baseInput,
      );

    assert.equal(
      result.status,
      "failed",
    );
    assert.equal(
      result.candidates.length,
      0,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "failure_policy_unsatisfied",
      ),
    );
  },
);

test(
  "minimum successful source policy is distinguishable from failure mode",
  async () => {
    const retriever =
      new HybridRetriever(
        [
          {
            source:
              new StaticRetrievalSource(
                "working",
                complete([]),
              ),
          },
          {
            source:
              new FailingRetrievalSource(
                "broken",
                "capability",
              ),
          },
        ],
        {
          minimumSuccessfulSources:
            2,
        },
      );

    const result =
      await retriever.retrieve(
        baseInput,
      );

    assert.equal(
      result.status,
      "failed",
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "minimum_sources_unsatisfied",
      ),
    );
  },
);

test(
  "pre-aborted requests return deterministic cancellation output",
  async () => {
    const controller =
      new AbortController();
    controller.abort();

    const retriever =
      new HybridRetriever([
        {
          source:
            new StaticRetrievalSource(
              "source",
              complete([]),
            ),
        },
      ]);

    const result =
      await retriever.retrieve({
        ...baseInput,
        abortSignal:
          controller.signal,
      });

    assert.equal(
      result.status,
      "cancelled",
    );
    assert.equal(
      result.statistics
        .attemptedSources,
      1,
    );
    assert.equal(
      result.statistics
        .failedSources,
      1,
    );
  },
);

test(
  "reranker failure behavior is explicit and configurable",
  async () => {
    const reranker:
      RetrievalReranker = {
        id:
          "failing-reranker",
        async rerank() {
          throw new Error(
            "Reranker failed.",
          );
        },
      };

    const registrations = [
      {
        source:
          new StaticRetrievalSource(
            "source",
            complete([
              candidate(
                "src/a.ts",
                "a",
                1,
              ),
            ]),
          ),
      },
    ];

    const fallback =
      await new HybridRetriever(
        registrations,
        {
          rerankerFailureMode:
            "fallback_to_fusion",
        },
        reranker,
      ).retrieve(baseInput);

    const required =
      await new HybridRetriever(
        registrations,
        {
          rerankerFailureMode:
            "fail",
        },
        reranker,
      ).retrieve(baseInput);

    assert.equal(
      fallback.status,
      "partial",
    );
    assert.equal(
      fallback.candidates.length,
      1,
    );
    assert.equal(
      required.status,
      "failed",
    );
    assert.ok(
      required.warnings.some(
        (warning) =>
          warning.code ===
          "reranker_failed",
      ),
    );
  },
);

test(
  "snapshot consistency guards drop stale repository intelligence and continue",
  async () => {
    const map: RepoMap = {
      schemaVersion:
        1,
      workspaceSnapshotId:
        "snapshot-b",
      codeIndexChangeToken:
        "change-1",
      entries: [],
      statistics: {
        availableFiles:
          0,
        rankedFiles:
          0,
        includedFiles:
          0,
        includedSymbols:
          0,
        estimatedTokens:
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

    const retriever =
      new HybridRetriever([
        {
          source:
            new StaticRetrievalSource(
              "lexical",
              complete([
                candidate(
                  "src/auth.ts",
                  "auth",
                  0.9,
                ),
              ]),
            ),
        },
      ]);

    const result =
      await retriever.retrieve({
        ...baseInput,
        workspaceSnapshotId:
          "snapshot-a",
        repoMap:
          map,
      });

    assert.equal(
      result.candidates.length,
      1,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
            "optional_source_unavailable" &&
          /workspace snapshot/i.test(
            warning.message,
          ),
      ),
    );
  },
);

test(
  "directory-like file paths are promoted to folderPrefix",
  async () => {
    let captured:
      | NormalizedHybridRetrievalRequest
      | undefined;
    const capture: RetrievalSource = {
      id: "capture",
      canRetrieve: () => true,
      retrieve: async (request) => {
        captured = request;
        return {
          status: "empty",
          candidates: [],
          truncated: false,
          warnings: [],
        };
      },
    };

    await new HybridRetriever([
      {
        source: capture,
      },
    ]).retrieve({
      ...baseInput,
      filePaths: [
        "packages/demo",
      ],
    });

    assert.equal(
      captured?.folderPrefix,
      "packages/demo",
    );
    assert.deepEqual(
      captured?.filePaths,
      [],
    );
  },
);

test(
  "repo map scope includes explicit files plus folder contents",
  async () => {
    const map: RepoMap = {
      schemaVersion:
        1,
      workspaceSnapshotId:
        "snapshot-1",
      codeIndexChangeToken:
        "change-1",
      entries: [
        repoMapEntry(
          "packages/mui-builder/src/FormBuilder.tsx",
          0.9,
        ),
        repoMapEntry(
          "tsconfig.json",
          0.8,
        ),
        repoMapEntry(
          "packages/other/src/Other.ts",
          1,
        ),
      ],
      statistics: {
        availableFiles:
          3,
        rankedFiles:
          3,
        includedFiles:
          3,
        includedSymbols:
          0,
        estimatedTokens:
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

    const result =
      await new HybridRetriever([
        {
          source:
            new RepoMapRetrievalSource(),
        },
      ]).retrieve({
        ...baseInput,
        folderPrefix:
          "packages/mui-builder",
        filePaths: [
          "tsconfig.json",
        ],
        repoMap:
          map,
      });

    assert.deepEqual(
      result.candidates.map(
        (entry) =>
          entry.relativePath,
      ),
      [
        "packages/mui-builder/src/FormBuilder.tsx",
        "tsconfig.json",
      ],
    );
  },
);

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

test(
  "factory rejects incomplete vector configuration",
  () => {
    const factory =
      new HybridRetrievalFactory();

    assert.throws(
      () =>
        factory.create({
          vectorIndex: {} as never,
        }),
      /must be configured together/i,
    );
  },
);

function createGraph(
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

function repoMapEntry(
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
