import assert from "node:assert/strict";
import test from "node:test";

import {
  CodeIndexDocumentMapper,
} from "../CodeIndexDocumentMapper";

import {
  CodeIndexPreparedFileIndexer,
} from "../CodeIndexPreparedFileIndexer";

import {
  CodeIndexUpdater,
} from "../CodeIndexUpdater";

import type {
  CodeIndexWritePort,
} from "../types";

import type {
  SourceAnalysis,
} from "../../source-analysis/types";

import type {
  WorkspaceFileEntry,
  WorkspaceSnapshot,
} from "../../workspace/types";

const file:
  WorkspaceFileEntry = {
  kind:
    "file",
  rootId:
    "root",
  relativePath:
    "src/index.ts",
  providerPath:
    "/workspace/src/index.ts",
  depth:
    2,
  size:
    20,
};

const snapshot:
  WorkspaceSnapshot = {
  schemaVersion:
    1,
  snapshotId:
    "a".repeat(
      64,
    ),
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
    file,
  ],
  warnings:
    [],
  statistics: {
    files:
      1,
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
      0,
  },
  limits: {
    maximumDepth:
      10,
    maximumFiles:
      100,
    maximumDirectories:
      100,
    timeoutMs:
      1_000,
    followSymbolicLinks:
      false,
  },
  status:
    "complete",
  generatedAt:
    "2026-07-25T12:00:00.000Z",
};

const sourceAnalysis = (
  status:
    SourceAnalysis[
      "status"
    ],
): SourceAnalysis => ({
  schemaVersion:
    1,
  sourceId:
    "source:root:src%2Findex.ts",
  rootId:
    "root",
  relativePath:
    "src/index.ts",
  ...(status ===
    "complete"
    ? {
        language:
          "typescript",
        parserId:
          "test-parser",
      }
    : {}),
  languageSource:
    status ===
      "complete"
      ? "extension"
      : "unknown",
  quality:
    status ===
      "complete"
      ? "precise"
      : "none",
  status,
  symbols:
    [],
  imports:
    [],
  references:
    [],
  warnings:
    [],
});

const writer = () => {
  let writes =
    0;

  const value:
    CodeIndexWritePort = {
    id:
      "test-writer",
    getFileState:
      async () =>
        null,
    replaceDocument:
      async (
        document,
      ) => {
        writes +=
          1;

        return {
          action:
            "inserted",
          file: {
            workspace:
              document.file.workspace,
            rootId:
              document.file.rootId,
            relativePath:
              document.file.relativePath,
          },
          revision:
            1,
          counts: {
            symbols:
              document
                .symbols
                .length,
            imports:
              document
                .imports
                .length,
            references:
              document
                .references
                .length,
          },
        };
      },
    refreshFileMetadata:
      async (
        version,
      ) => ({
        action:
          "metadata_refreshed",
        file: {
          workspace:
            version.workspace,
          rootId:
            version.rootId,
          relativePath:
            version.relativePath,
        },
        revision:
          1,
        counts: {
          symbols:
            0,
          imports:
            0,
          references:
            0,
        },
      }),
    removeFile:
      async (
        locator,
      ) => ({
        action:
          "removed",
        file:
          locator,
        revision:
          1,
        counts: {
          symbols:
            0,
          imports:
            0,
          references:
            0,
        },
      }),
    removeMissingFiles:
      async () => ({
        removedRelativePaths:
          [],
        revision:
          1,
      }),
    getRevision:
      async () =>
        1,
  };

  return {
    value,
    writes:
      () =>
        writes,
  };
};

test(
  "prepared indexer persists existing analysis without reading or parsing again",
  async () => {
    const storage =
      writer();
    const indexer =
      new CodeIndexPreparedFileIndexer(
        new CodeIndexDocumentMapper(),
        new CodeIndexUpdater(
          storage.value,
        ),
      );

    const result =
      await indexer
        .index({
          workspace:
            "workspace",
          snapshot,
          file,
          analysis:
            sourceAnalysis(
              "complete",
            ),
          contentHash:
            "b".repeat(
              64,
            ),
          indexedAt:
            100,
        });

    assert.equal(
      result.status,
      "indexed",
    );
    assert.equal(
      storage.writes(),
      1,
    );
  },
);

test(
  "failed prepared analysis cannot replace a valid index document",
  async () => {
    const storage =
      writer();
    const indexer =
      new CodeIndexPreparedFileIndexer(
        new CodeIndexDocumentMapper(),
        new CodeIndexUpdater(
          storage.value,
        ),
      );

    const result =
      await indexer
        .index({
          workspace:
            "workspace",
          snapshot,
          file,
          analysis:
            sourceAnalysis(
              "failed",
            ),
          contentHash:
            "b".repeat(
              64,
            ),
          indexedAt:
            100,
        });

    assert.equal(
      result.status,
      "analysis_failed",
    );
    assert.equal(
      storage.writes(),
      0,
    );
  },
);
