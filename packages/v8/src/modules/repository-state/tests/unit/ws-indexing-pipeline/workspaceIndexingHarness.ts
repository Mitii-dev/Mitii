import type { WorkspaceIndexingPipelineDependencies } from "../../../flow/ws-indexing-pipeline/types";
import type { Chunk, ChunkingResult } from "../../../helpers/chunking/types";
import type {
  CodeIndexCoordinatorResult,
} from "../../../helpers/code-indexing/types";
import type {
  EmbeddingSynchronizationResult,
} from "../../../helpers/embedding/types";
import type { SourceAnalysis } from "../../../helpers/source-analysis/types";
import type {
  TextIndexCoordinatorResult,
} from "../../../helpers/text-index/types";
import type {
  WorkspaceFileEntry,
  WorkspaceSnapshot,
} from "../../../helpers/workspace/types";

export const SNAPSHOT_ID =
  "a".repeat(
    64,
  );

export const CONTENT_HASH =
  "b".repeat(
    64,
  );

export const file = (
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

export const snapshot = (
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

export const analysis = (
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

export const chunking = (
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

export const codeResult = (
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

export const textResult = (
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

export const embeddingResult =
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

export const dependencies = (
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
