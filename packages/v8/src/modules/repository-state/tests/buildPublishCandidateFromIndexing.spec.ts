import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryRepositoryStateStore,
  RepositoryStatePipeline,
} from "../index";
import { WORKSPACE_INDEXING_PIPELINE_MESSAGES } from "../pipeline/ws-indexing-pipeline/constants";
import {
  buildPublishCandidateFromIndexing,
} from "../actions/buildPublishCandidateFromIndexing";
import type { WorkspaceIndexingPipelineResult } from "../pipeline/ws-indexing-pipeline/types";

const SNAPSHOT_ID = "c".repeat(64);
const INDEXED_AT = Date.parse("2026-07-25T19:00:00.000Z");

const createIndexingResult = (
  overrides: Partial<WorkspaceIndexingPipelineResult> = {},
): WorkspaceIndexingPipelineResult => ({
  schemaVersion: 1,
  workspace: "workspace",
  workspaceSnapshotId: SNAPSHOT_ID,
  indexedAt: INDEXED_AT,
  status: "complete",
  fileResults: [],
  fileResultsTruncated: false,
  rootResults: [
    {
      rootId: "root-a",
      status: "complete",
      cleanupPerformed: true,
      codeIndexRemovedFiles: 0,
      textIndexRemovedDocuments: 0,
      textIndexRemovedChunks: 0,
      codeIndexRevision: 7,
      embeddingStatus: "complete",
      embeddingProfileId: "default",
      finalTextRevision: 3,
      latestTextRevision: 3,
      embeddedChunks: 10,
      vectorsDeleted: 0,
      warnings: [],
    },
  ],
  warnings: [],
  cleanupAllowed: true,
  statistics: {
    availableFiles: 1,
    selectedFiles: 1,
    skippedFiles: 0,
    processedFiles: 1,
    completeFiles: 1,
    partialFiles: 0,
    failedFiles: 0,
    cancelledFiles: 0,
    analysisFailures: 0,
    emittedChunks: 10,
    estimatedTokens: 100,
    codeIndexUpdates: 1,
    textIndexUpdates: 1,
    embeddedChunks: 10,
    removedCodeIndexFiles: 0,
    removedTextIndexDocuments: 0,
    removedTextIndexChunks: 0,
    reportedFileResults: 0,
  },
  ...overrides,
});

test("maps a complete indexing result into a publishable candidate", () => {
  const built = buildPublishCandidateFromIndexing(createIndexingResult());

  assert.equal(built.status, "ready");
  if (built.status !== "ready") {
    return;
  }

  assert.equal(built.candidate.workspaceId, "workspace");
  assert.equal(built.candidate.snapshotId, SNAPSHOT_ID);
  assert.equal(built.candidate.scanCompleteness, "complete");
  assert.equal(built.candidate.roots[0]?.codeIndexRevision, "7");
  assert.equal(built.candidate.roots[0]?.textIndexRevision, "3");
  assert.equal(built.candidate.roots[0]?.vectorProfile, "default");
  assert.equal(built.candidate.roots[0]?.vectorIndexRevision, "3");
  assert.equal(
    built.candidate.roots[0]?.capabilities.find(
      (entry) => entry.capability === "graph",
    )?.status,
    "unavailable",
  );
});

test("filtered and truncated indexing runs map to non-complete scan completeness", () => {
  const filtered = buildPublishCandidateFromIndexing(
    createIndexingResult({
      cleanupAllowed: false,
      warnings: [
        {
          stage: "cleanup",
          code: "cleanup_skipped",
          message: WORKSPACE_INDEXING_PIPELINE_MESSAGES.CLEANUP_FILTERED_RUN,
        },
      ],
    }),
  );
  assert.equal(filtered.status, "ready");
  if (filtered.status === "ready") {
    assert.equal(filtered.candidate.scanCompleteness, "filtered");
  }

  const truncated = buildPublishCandidateFromIndexing(
    createIndexingResult({
      cleanupAllowed: false,
      fileResultsTruncated: true,
      warnings: [
        {
          stage: "cleanup",
          code: "cleanup_skipped",
          message: WORKSPACE_INDEXING_PIPELINE_MESSAGES.CLEANUP_TRUNCATED_RUN,
        },
      ],
    }),
  );
  assert.equal(truncated.status, "ready");
  if (truncated.status === "ready") {
    assert.equal(truncated.candidate.scanCompleteness, "truncated");
  }
});

test("graph and map revision overlays mark those capabilities ready", () => {
  const built = buildPublishCandidateFromIndexing(createIndexingResult(), {
    graphRevisionByRoot: { "root-a": "graph-9" },
    mapRevisionByRoot: { "root-a": "map-4" },
  });

  assert.equal(built.status, "ready");
  if (built.status !== "ready") {
    return;
  }

  const root = built.candidate.roots[0];
  assert.equal(root?.graphRevision, "graph-9");
  assert.equal(root?.mapRevision, "map-4");
  assert.equal(
    root?.capabilities.find((entry) => entry.capability === "graph")?.status,
    "ready",
  );
  assert.equal(
    root?.capabilities.find((entry) => entry.capability === "map")?.status,
    "ready",
  );
});

test("publishFromIndexing publishes an authoritative descriptor", async () => {
  const pipeline = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });

  const result = await pipeline.publishFromIndexing(createIndexingResult());

  assert.equal(result.status, "published");
  if (result.status !== "published") {
    return;
  }

  assert.equal(result.descriptor.readiness, "ready");
  assert.equal(result.descriptor.cleanupAllowed, true);
  assert.equal(result.descriptor.snapshotId, SNAPSHOT_ID);
  assert.match(result.reference.stateToken, /^[a-f0-9]{64}$/);

  const latest = await pipeline.getLatest("workspace");
  assert.equal(latest?.stateToken, result.reference.stateToken);
});

test("publishFromIndexing blocks cleanup for incomplete indexing scans", async () => {
  const pipeline = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });

  const result = await pipeline.publishFromIndexing(
    createIndexingResult({
      status: "partial",
      cleanupAllowed: false,
      warnings: [
        {
          stage: "cleanup",
          code: "cleanup_skipped",
          message:
            WORKSPACE_INDEXING_PIPELINE_MESSAGES.CLEANUP_PARTIAL_SNAPSHOT,
        },
      ],
    }),
  );

  assert.equal(result.status, "published");
  if (result.status !== "published") {
    return;
  }

  assert.equal(result.descriptor.scanCompleteness, "partial");
  assert.equal(result.descriptor.cleanupAllowed, false);
  assert.equal(result.descriptor.readiness, "degraded");
});

test("rejects indexing results with no roots", async () => {
  const pipeline = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });

  const result = await pipeline.publishFromIndexing(
    createIndexingResult({
      rootResults: [],
    }),
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.code, "invalid_candidate");
  }
});
