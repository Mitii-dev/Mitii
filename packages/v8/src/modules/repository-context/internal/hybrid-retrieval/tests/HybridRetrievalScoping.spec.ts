import assert from "node:assert/strict";
import test from "node:test";
import { HybridRetrievalFactory } from "../HybridRetrievalFactory";
import { HybridRetriever } from "../HybridRetriever";
import { RepoMapRetrievalSource } from "../sources";
import type {
  NormalizedHybridRetrievalRequest,
  RetrievalSource,
} from "../types";
import type { RepoGraph } from "../../../../repository-state/index";
import type { RepoMap } from "../../../../repository-state/index";
import {
  StaticRetrievalSource,
  candidate,
  complete,
  baseInput,
  repoMapEntry,
} from "./hybridRetrievalHarness";

test(
  "snapshot consistency guards rebind stale repository intelligence and continue",
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

test(
  "query-time repo map re-rank prefers open files over published scores",
  async () => {
    const paths = [
      "src/feature/active.ts",
      "src/feature/archive.ts",
      "src/feature/readme.ts",
    ] as const;
    const graph: RepoGraph = {
      schemaVersion: 1,
      workspaceSnapshotId: "snapshot-1",
      codeIndexChangeToken: "change-1",
      nodes: paths.map((relativePath) => ({
        id: `file:${relativePath}`,
        kind: "file" as const,
        fileId: `file:${relativePath}`,
        rootId: "root",
        relativePath,
      })),
      edges: [],
      warnings: [],
      statistics: {
        availableFiles: paths.length,
        indexedFiles: paths.length,
        projectNodes: 0,
        fileNodes: paths.length,
        symbolNodes: 0,
        containsEdges: 0,
        declaresEdges: 0,
        importEdges: 0,
        referenceEdges: 0,
        projectRelationshipEdges: 0,
        unresolvedImports: 0,
        omittedImportTargets: 0,
        ambiguousReferences: 0,
        unresolvedReferences: 0,
        omittedReferenceTargets: 0,
        omittedParentSymbolTargets: 0,
        truncatedSymbolFiles: 0,
        droppedSymbolNodes: 0,
        droppedEdges: 0,
        consistencyRetries: 0,
        durationMs: 0,
      },
      status: "complete",
      generatedAt: new Date(0).toISOString(),
    };

    const publishedMap: RepoMap = {
      schemaVersion: 1,
      workspaceSnapshotId: "snapshot-1",
      codeIndexChangeToken: "change-1",
      entries: [
        repoMapEntry("src/feature/readme.ts", 1),
        repoMapEntry("src/feature/active.ts", 0.2),
        repoMapEntry("src/feature/archive.ts", 0.1),
      ],
      statistics: {
        availableFiles: 3,
        rankedFiles: 3,
        includedFiles: 3,
        includedSymbols: 0,
        estimatedTokens: 0,
        durationMs: 0,
      },
      status: "complete",
      generatedAt: new Date(0).toISOString(),
    };

    const result = await new HybridRetriever([
      {
        source: new RepoMapRetrievalSource(),
      },
    ]).retrieve({
      ...baseInput,
      query: "feature",
      repoMap: publishedMap,
      repoGraph: graph,
      rankingContext: {
        openFiles: ["src/feature/archive.ts"],
      },
    });

    assert.equal(
      result.candidates[0]?.relativePath,
      "src/feature/archive.ts",
    );
  },
);

test(
  "priority paths are prepended ahead of higher RRF lexical hits",
  async () => {
    const result = await new HybridRetriever([
      {
        source: new StaticRetrievalSource(
          "lexical",
          complete([
            candidate("src/noise/a.ts", "a", 1),
            candidate("src/noise/b.ts", "b", 0.95),
            candidate("src/target/Important.ts", "important", 0.1),
          ]),
        ),
        weight: 1,
      },
    ]).retrieve({
      ...baseInput,
      maximumResults: 3,
      rankingContext: {
        priorityPaths: ["src/target/Important.ts"],
      },
    });

    assert.equal(
      result.candidates[0]?.relativePath,
      "src/target/Important.ts",
    );
  },
);
