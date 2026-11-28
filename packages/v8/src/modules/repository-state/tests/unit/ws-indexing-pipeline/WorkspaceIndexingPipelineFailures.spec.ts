import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceIndexingPipeline } from "../../../flow/ws-indexing-pipeline/WorkspaceIndexingPipeline";
import type { ChunkingResult } from "../../../helpers/chunking/types";
import type { SourceAnalysis } from "../../../helpers/source-analysis/types";
import {
  file,
  snapshot,
  chunking,
  dependencies,
} from "./workspaceIndexingHarness";

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
