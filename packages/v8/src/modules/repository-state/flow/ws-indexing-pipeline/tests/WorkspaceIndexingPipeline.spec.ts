import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceIndexingPipeline } from "../WorkspaceIndexingPipeline";
import { TEXT_INDEX_DEFAULTS } from "../../../helpers/text-index/constants";
import {
  SNAPSHOT_ID,
  CONTENT_HASH,
  file,
  snapshot,
  analysis,
  chunking,
  dependencies,
} from "./workspaceIndexingHarness";

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
  "skips analysis and chunking when code and text indexes are fresh",
  async () => {
    const target =
      file(
        "src/fresh.ts",
      );
    let analyzed =
      0;
    let chunked =
      0;

    const setup =
      dependencies({
        analyzer: {
          analyze:
            async (
              input,
            ) => {
              analyzed +=
                1;
              return analysis(
                input.file,
              );
            },
        },
        chunker: {
          chunk:
            async (
              input,
            ) => {
              chunked +=
                1;
              return chunking(
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
              );
            },
        },
        freshness: {
          getCodeFileState:
            async () => ({
              workspace:
                "workspace",
              rootId:
                "root",
              relativePath:
                target
                  .relativePath,
              providerPath:
                target
                  .providerPath,
              contentHash:
                CONTENT_HASH,
              size:
                target.size ?? 0,
              analysisVersion:
                "source-analysis-v1",
              analysisStatus:
                "complete",
              indexedAt:
                1,
            }),
          getTextDocumentState:
            async () => ({
              workspace:
                "workspace",
              rootId:
                "root",
              relativePath:
                target
                  .relativePath,
              sourceId:
                `source:root:${encodeURIComponent(target.relativePath)}`,
              sourceContentHash:
                CONTENT_HASH,
              pipelineVersion:
                TEXT_INDEX_DEFAULTS
                  .PIPELINE_VERSION,
              chunkingStatus:
                "complete",
              chunkCount:
                1,
              workspaceSnapshotId:
                SNAPSHOT_ID,
              indexedAt:
                1,
            }),
        },
      });
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
              target,
            ]),
          indexedAt:
            200,
          cleanupMissing:
            false,
          synchronizeEmbeddings:
            false,
        });

    assert.equal(
      analyzed,
      0,
    );
    assert.equal(
      chunked,
      0,
    );
    assert.equal(
      result.fileResults[0]
        ?.codeIndexStatus,
      "unchanged",
    );
    assert.equal(
      result.fileResults[0]
        ?.textIndexStatus,
      "unchanged",
    );
    assert.equal(
      result.fileResults[0]
        ?.contentHash,
      CONTENT_HASH,
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
