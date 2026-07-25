import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceIndexingPipeline,
} from "../WorkspaceIndexingPipeline";

import type {
  WorkspaceIndexingPipelineDependencies,
} from "../types";

import type {
  Chunk,
  ChunkingResult,
} from "../../chunking/types";

import type {
  CodeIndexCoordinatorResult,
} from "../../code-indexing/types";

import type {
  EmbeddingSynchronizationResult,
} from "../../embedding/types";

import type {
  SourceAnalysis,
} from "../../source-analysis/types";

import type {
  TextIndexCoordinatorResult,
} from "../../text-index/types";

import type {
  WorkspaceFileEntry,
  WorkspaceSnapshot,
} from "../../workspace/types";

const SNAPSHOT_ID =
  "a".repeat(
    64,
  );

const CONTENT_HASH =
  "b".repeat(
    64,
  );

const file = (
  relativePath:
    string,
): WorkspaceFileEntry => ({
  kind:
    "file",
  rootId:
    "root",
  relativePath,
  providerPath:
    `/workspace/${relativePath}`,
  depth:
    relativePath
      .split("/")
      .length,
  size:
    20,
});

const snapshot = (
  files:
    readonly WorkspaceFileEntry[],
  status:
    WorkspaceSnapshot[
      "status"
    ] =
    "complete",
): WorkspaceSnapshot => ({
  schemaVersion:
    1,
  snapshotId:
    SNAPSHOT_ID,
  roots: [
    {
      id:
        "root",
      name:
        "root",
      kind:
        "directory",
    },
  ],
  entries: [
    ...files,
  ],
  warnings:
    [],
  statistics: {
    files:
      files.length,
    directories:
      0,
    symbolicLinks:
      0,
    otherEntries:
      0,
    ignoredEntries:
      0,
    warnings:
      0,
    durationMs:
      1,
  },
  limits: {
    maximumDepth:
      20,
    maximumFiles:
      1_000,
    maximumDirectories:
      1_000,
    timeoutMs:
      5_000,
    followSymbolicLinks:
      false,
  },
  status,
  generatedAt:
    "2026-07-25T12:00:00.000Z",
});

const analysis = (
  target:
    WorkspaceFileEntry,
): SourceAnalysis => ({
  schemaVersion:
    1,
  sourceId:
    `source:root:${encodeURIComponent(target.relativePath)}`,
  rootId:
    target.rootId,
  relativePath:
    target.relativePath,
  language:
    "typescript",
  languageSource:
    "extension",
  parserId:
    "test-parser",
  quality:
    "precise",
  status:
    "complete",
  symbols:
    [],
  imports:
    [],
  references:
    [],
  warnings:
    [],
});

const chunking = (
  target:
    WorkspaceFileEntry,
  sourceId:
    string,
): ChunkingResult => {
  const chunk:
    Chunk = {
    id:
      `chunk:${target.relativePath}`,
    sourceId,
    rootId:
      target.rootId,
    relativePath:
      target.relativePath,
    strategyId:
      "code",
    ordinal:
      0,
    kind:
      "code_region",
    content:
      "export const value = 1;",
    sourceContentHash:
      CONTENT_HASH,
    contentHash:
      CONTENT_HASH,
    tokenEstimate:
      6,
    startOffset:
      0,
    endOffset:
      23,
    startLine:
      1,
    endLine:
      1,
  };

  return {
    schemaVersion:
      1,
    sourceId,
    rootId:
      target.rootId,
    relativePath:
      target.relativePath,
    language:
      "typescript",
    sourceContentHash:
      CONTENT_HASH,
    strategyId:
      "code",
    status:
      "complete",
    chunks: [
      chunk,
    ],
    warnings:
      [],
    statistics: {
      inputCharacters:
        23,
      processedCharacters:
        23,
      omittedCharacters:
        0,
      inputLines:
        1,
      emittedChunks:
        1,
      estimatedTokens:
        6,
    },
  };
};

const codeResult = (
  sourceAnalysis:
    SourceAnalysis,
): CodeIndexCoordinatorResult => ({
  status:
    "indexed",
  analysis:
    sourceAnalysis,
  update: {
    status:
      "indexed",
    plan: {
      action:
        "insert",
      reason:
        "file_not_indexed",
    },
  },
});

const textResult = (
  chunkingResult:
    ChunkingResult,
): TextIndexCoordinatorResult => ({
  schemaVersion:
    1,
  status:
    "indexed",
  chunkingStatus:
    chunkingResult
      .status,
  update: {
    status:
      "indexed",
    plan: {
      action:
        "insert",
      reason:
        "document_not_indexed",
    },
  },
});

const embeddingResult =
  (
    rootId:
      string,
  ): EmbeddingSynchronizationResult => ({
    schemaVersion:
      1,
    status:
      "complete",
    workspace:
      "workspace",
    rootId,
    profile: {
      id:
        "embedding-v1",
      providerId:
        "test",
      modelId:
        "test-model",
      dimensions:
        3,
      normalized:
        true,
    },
    initialTextRevision:
      0,
    finalTextRevision:
      3,
    latestTextRevision:
      3,
    warnings:
      [],
    statistics: {
      changeBatchesRead:
        1,
      writeBatchesApplied:
        1,
      changesRead:
        1,
      chunksEmbedded:
        1,
      vectorsDeleted:
        0,
      providerCalls:
        1,
      truncatedInputs:
        0,
    },
  });

const dependencies = (
  overrides: Partial<
    WorkspaceIndexingPipelineDependencies
  > = {},
) => {
  const readCount =
    new Map<
      string,
      number
    >();

  const defaults:
    WorkspaceIndexingPipelineDependencies = {
    reader: {
      read:
        async (
          input,
        ) => {
          readCount.set(
            input.file
              .relativePath,
            (
              readCount.get(
                input.file
                  .relativePath,
              ) ??
              0
            ) +
              1,
          );

          return {
            sourceId:
              input.sourceId,
            rootId:
              input.file
                .rootId,
            relativePath:
              input.file
                .relativePath,
            providerPath:
              input.file
                .providerPath ??
              "/workspace/file.ts",
            content:
              "export const value = 1;",
            byteLength:
              23,
          };
        },
    },
    analyzer: {
      analyze:
        async (
          input,
        ) =>
          analysis(
            input.file,
          ),
    },
    contentHasher: {
      id:
        "test-hasher",
      hash:
        () =>
          CONTENT_HASH,
    },
    chunker: {
      chunk:
        async (
          input,
        ) =>
          chunking(
            {
              kind:
                "file",
              rootId:
                input.rootId,
              relativePath:
                input
                  .relativePath,
              depth:
                1,
            },
            input.sourceId,
          ),
    },
    codeIndexer: {
      index:
        async (
          input,
        ) =>
          codeResult(
            input.analysis,
          ),
    },
    textIndexer: {
      index:
        async (
          input,
        ) =>
          textResult(
            input.chunking,
          ),
    },
    codeIndex: {
      removeMissingFiles:
        async (
          input,
        ) => ({
          removedRelativePaths:
            input
              .retainedRelativePaths
              .length > 0
              ? [
                  "src/removed.ts",
                ]
              : [],
          revision:
            4,
        }),
      getRevision:
        async () =>
          4,
    },
    textIndex: {
      removeMissingDocuments:
        async (
          input,
        ) => ({
          removedRelativePaths:
            input
              .retainedRelativePaths
              .length > 0
              ? [
                  "src/removed.ts",
                ]
              : [],
          removedChunks:
            input
              .retainedRelativePaths
              .length > 0
              ? 2
              : 0,
          revision:
            3,
        }),
    },
    embedding: {
      synchronize:
        async (
          input,
        ) =>
          embeddingResult(
            input.rootId,
          ),
    },
  };

  return {
    readCount,
    value: {
      ...defaults,
      ...overrides,
    },
  };
};

test(
  "reads each file once and shares prepared facts across every index",
  async () => {
    const setup =
      dependencies();
    const pipeline =
      new WorkspaceIndexingPipeline(
        setup.value,
      );

    const result =
      await pipeline
        .execute({
          workspace:
            "workspace",
          snapshot:
            snapshot([
              file(
                "src/index.ts",
              ),
            ]),
          indexedAt:
            100,
        });

    assert.equal(
      setup.readCount
        .get(
          "src/index.ts",
        ),
      1,
    );
    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.cleanupAllowed,
      true,
    );
    assert.equal(
      result
        .statistics
        .codeIndexUpdates,
      1,
    );
    assert.equal(
      result
        .statistics
        .textIndexUpdates,
      1,
    );
    assert.equal(
      result
        .statistics
        .embeddedChunks,
      1,
    );
    assert.equal(
      result
        .statistics
        .removedCodeIndexFiles,
      1,
    );
  },
);

test(
  "partial snapshots index visible files but never remove unseen files",
  async () => {
    let cleanupCalls =
      0;
    const base =
      dependencies();
    const setup =
      dependencies({
        codeIndex: {
          ...base
            .value
            .codeIndex,
          removeMissingFiles:
            async (
              input,
              context,
            ) => {
              cleanupCalls +=
                1;

              return base
                .value
                .codeIndex
                .removeMissingFiles(
                  input,
                  context,
                );
            },
        },
        textIndex: {
          removeMissingDocuments:
            async () => {
              cleanupCalls +=
                1;

              return {
                removedRelativePaths:
                  [],
                removedChunks:
                  0,
                revision:
                  0,
              };
            },
        },
      });

    const result =
      await new WorkspaceIndexingPipeline(
        setup.value,
      )
        .execute({
          workspace:
            "workspace",
          snapshot:
            snapshot(
              [
                file(
                  "src/index.ts",
                ),
              ],
              "partial",
            ),
          indexedAt:
            100,
        });

    assert.equal(
      cleanupCalls,
      0,
    );
    assert.equal(
      result.cleanupAllowed,
      false,
    );
    assert.equal(
      result.status,
      "partial",
    );
    assert.ok(
      result.warnings
        .some(
          (warning) =>
            warning.code ===
            "cleanup_skipped",
        ),
    );
  },
);

test(
  "file-filtered runs cannot delete documents outside their scope",
  async () => {
    let cleanupCalls =
      0;
    const setup =
      dependencies({
        textIndex: {
          removeMissingDocuments:
            async () => {
              cleanupCalls +=
                1;

              return {
                removedRelativePaths:
                  [],
                removedChunks:
                  0,
                revision:
                  0,
              };
            },
        },
      });

    const result =
      await new WorkspaceIndexingPipeline(
        setup.value,
      )
        .execute({
          workspace:
            "workspace",
          snapshot:
            snapshot([
              file(
                "src/index.ts",
              ),
              file(
                "src/other.ts",
              ),
            ]),
          filePaths: [
            "src/index.ts",
          ],
          indexedAt:
            100,
        });

    assert.equal(
      cleanupCalls,
      0,
    );
    assert.equal(
      result.cleanupAllowed,
      false,
    );
    assert.equal(
      result.status,
      "complete",
    );
  },
);

test(
  "fail-fast mode stops scheduling files after a hard read failure",
  async () => {
    const setup =
      dependencies({
        reader: {
          read:
            async (
              input,
            ) => {
              if (
                input.file
                  .relativePath ===
                "src/a.ts"
              ) {
                throw new Error(
                  "Read failed.",
                );
              }

              return {
                sourceId:
                  input
                    .sourceId,
                rootId:
                  input.file
                    .rootId,
                relativePath:
                  input.file
                    .relativePath,
                providerPath:
                  "/workspace/file.ts",
                content:
                  "export const value = 1;",
                byteLength:
                  23,
              };
            },
        },
      });

    const result =
      await new WorkspaceIndexingPipeline(
        setup.value,
      )
        .execute({
          workspace:
            "workspace",
          snapshot:
            snapshot([
              file(
                "src/a.ts",
              ),
              file(
                "src/b.ts",
              ),
            ]),
          indexedAt:
            100,
          concurrency:
            1,
          failureMode:
            "fail_fast",
        });

    assert.equal(
      result.status,
      "failed",
    );
    assert.equal(
      result
        .statistics
        .processedFiles,
      1,
    );
    assert.equal(
      result.cleanupAllowed,
      false,
    );
  },
);

test(
  "pre-aborted runs perform no repository work",
  async () => {
    const controller =
      new AbortController();
    controller.abort();

    const setup =
      dependencies({
        reader: {
          read:
            async () => {
              throw new Error(
                "Reader must not be called.",
              );
            },
        },
      });

    const result =
      await new WorkspaceIndexingPipeline(
        setup.value,
      )
        .execute({
          workspace:
            "workspace",
          snapshot:
            snapshot([
              file(
                "src/index.ts",
              ),
            ]),
          indexedAt:
            100,
          abortSignal:
            controller.signal,
        });

    assert.equal(
      result.status,
      "cancelled",
    );
    assert.equal(
      result
        .statistics
        .processedFiles,
      0,
    );
  },
);

test(
  "file-policy failures exclude the file and disable destructive cleanup",
  async () => {
    let cleanupCalls =
      0;
    const base =
      dependencies();
    const setup =
      dependencies({
        filePolicy: {
          evaluate:
            async () => {
              throw new Error(
                "Policy unavailable.",
              );
            },
        },
        codeIndex: {
          ...base
            .value
            .codeIndex,
          removeMissingFiles:
            async (
              input,
              context,
            ) => {
              cleanupCalls +=
                1;

              return base
                .value
                .codeIndex
                .removeMissingFiles(
                  input,
                  context,
                );
            },
        },
        textIndex: {
          removeMissingDocuments:
            async () => {
              cleanupCalls +=
                1;

              return {
                removedRelativePaths:
                  [],
                removedChunks:
                  0,
                revision:
                  0,
              };
            },
        },
      });

    const result =
      await new WorkspaceIndexingPipeline(
        setup.value,
      )
        .execute({
          workspace:
            "workspace",
          snapshot:
            snapshot([
              file(
                "src/index.ts",
              ),
            ]),
          indexedAt:
            100,
        });

    assert.equal(
      setup.readCount
        .size,
      0,
    );
    assert.equal(
      cleanupCalls,
      0,
    );
    assert.equal(
      result.cleanupAllowed,
      false,
    );
    assert.equal(
      result
        .statistics
        .skippedFiles,
      1,
    );
    assert.ok(
      result.warnings
        .some(
          (warning) =>
            warning.code ===
            "file_policy_failed",
        ),
    );
  },
);

test(
  "reports failure when neither index produces usable state",
  async () => {
    const target =
      file(
        "src/index.ts",
      );

    const failedAnalysis:
      SourceAnalysis = {
      schemaVersion:
        1,
      sourceId:
        `source:root:${encodeURIComponent(target.relativePath)}`,
      rootId:
        target.rootId,
      relativePath:
        target.relativePath,
      languageSource:
        "unknown",
      quality:
        "none",
      status:
        "failed",
      symbols:
        [],
      imports:
        [],
      references:
        [],
      warnings:
        [],
    };

    const failedChunking:
      ChunkingResult = {
      ...chunking(
        target,
        failedAnalysis
          .sourceId,
      ),
      status:
        "failed",
      chunks:
        [],
      warnings: [
        {
          code:
            "strategy_failed",
          message:
            "Chunking failed.",
        },
      ],
      statistics: {
        inputCharacters:
          23,
        processedCharacters:
          0,
        omittedCharacters:
          23,
        inputLines:
          1,
        emittedChunks:
          0,
        estimatedTokens:
          0,
      },
    };

    const setup =
      dependencies({
        analyzer: {
          analyze:
            async () =>
              failedAnalysis,
        },
        chunker: {
          chunk:
            async () =>
              failedChunking,
        },
        codeIndexer: {
          index:
            async (
              input,
            ) => ({
              status:
                "analysis_failed",
              analysis:
                input
                  .analysis,
            }),
        },
        textIndexer: {
          index:
            async (
              input,
            ) => ({
              schemaVersion:
                1,
              status:
                "not_indexable",
              chunkingStatus:
                input
                  .chunking
                  .status,
            }),
        },
      });

    const result =
      await new WorkspaceIndexingPipeline(
        setup.value,
      )
        .execute({
          workspace:
            "workspace",
          snapshot:
            snapshot([
              target,
            ]),
          indexedAt:
            100,
        });

    assert.equal(
      result
        .fileResults[
        0
      ]?.status,
      "failed",
    );
    assert.equal(
      result
        .statistics
        .failedFiles,
      1,
    );
    assert.equal(
      result.status,
      "partial",
    );
  },
);
