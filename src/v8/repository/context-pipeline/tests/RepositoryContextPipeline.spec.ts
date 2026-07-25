import assert from "node:assert/strict";
import test from "node:test";

import {
  RepositoryContextPipeline,
  repositoryContextPipelineInputSchema,
} from "../index";

import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
} from "../../context-assembly/types";

import type {
  ContextSelectionInput,
  ContextSelectionResult,
} from "../../context-selection/types";

import type {
  HybridRetrievalInput,
  HybridRetrievalResult,
} from "../../hybrid-retrieval/types";

import type {
  WorkspaceSnapshot,
} from "../../workspace/types";

const SNAPSHOT_ID =
  "a".repeat(
    64,
  );

const snapshot:
  WorkspaceSnapshot = {
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
  entries:
    [],
  warnings:
    [],
  statistics: {
    files:
      0,
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

const emptyRetrieval = (
  query: string,
): HybridRetrievalResult => ({
  schemaVersion:
    1,
  query,
  status:
    "empty",
  candidates:
    [],
  sourceReports:
    [],
  warnings:
    [],
  truncated:
    false,
  statistics: {
    configuredSources:
      0,
    attemptedSources:
      0,
    successfulSources:
      0,
    failedSources:
      0,
    skippedSources:
      0,
    sourceCandidates:
      0,
    uniqueCandidates:
      0,
    duplicateCandidatesRemoved:
      0,
    returnedCandidates:
      0,
  },
});

const emptySelection = (
  input:
    ContextSelectionInput,
): ContextSelectionResult => ({
  schemaVersion:
    1,
  query:
    input.query,
  mode:
    input.mode ??
    "ask",
  breadth:
    input.breadth ??
    "balanced",
  status:
    "empty",
  items:
    [],
  dropped:
    [],
  warnings:
    [],
  budget: {
    maximumTokens:
      1_000,
    usedTokens:
      0,
    remainingTokens:
      1_000,
    maximumItems:
      10,
    maximumFiles:
      10,
    maximumItemsPerFile:
      2,
  },
  statistics: {
    retrievedCandidates:
      0,
    synthesizedReferences:
      0,
    consideredCandidates:
      0,
    selectedItems:
      0,
    droppedItems:
      0,
    selectedFiles:
      0,
    selectedRoots:
      0,
    requiredItems:
      0,
    preferredItems:
      0,
    supplementaryItems:
      0,
    fullFileItems:
      0,
    exactRangeItems:
      0,
    targetedExcerptItems:
      0,
    fileOutlineItems:
      0,
    symbolSignatureItems:
      0,
  },
});

const emptyAssembly = (
  input:
    ContextAssemblyInput,
): ContextAssemblyResult => ({
  schemaVersion:
    1,
  workspaceSnapshotId:
    input.snapshot
      .snapshotId,
  selectionStatus:
    input.selection
      .status,
  status:
    "empty",
  blocks:
    [],
  dropped:
    [],
  warnings:
    [],
  budget: {
    allocatedTokens:
      0,
    usedTokens:
      0,
    remainingTokens:
      0,
  },
  statistics: {
    selectedItems:
      0,
    attemptedItems:
      0,
    assembledBlocks:
      0,
    droppedBlocks:
      0,
    loadedFiles:
      0,
    loadedRoots:
      0,
    truncatedBlocks:
      0,
    fallbackBlocks:
      0,
    redactedBlocks:
      0,
    redactionCount:
      0,
    inputCharacters:
      0,
    outputCharacters:
      0,
  },
});

test(
  "pipeline runs retrieval, selection, and assembly in order",
  async () => {
    const calls:
      string[] = [];
    let retrievalInput:
      HybridRetrievalInput |
      undefined;

    const pipeline =
      new RepositoryContextPipeline({
        retriever: {
          retrieve:
            async (
              input,
            ) => {
              calls.push(
                "retrieval",
              );
              retrievalInput =
                input;

              return emptyRetrieval(
                input.query,
              );
            },
        },
        selector: {
          select:
            (
              input,
            ) => {
              calls.push(
                "selection",
              );

              return emptySelection(
                input,
              );
            },
        },
        assembler: {
          assemble:
            async (
              input,
            ) => {
              calls.push(
                "assembly",
              );

              return emptyAssembly(
                input,
              );
            },
        },
      });

    const result =
      await pipeline
        .execute({
          workspace:
            "workspace",
          query:
            "Find authentication code",
          mode:
            "plan",
          snapshot,
          codeIndexChangeToken:
            "index-1",
          rootIds: [
            "root",
          ],
        });

    assert.deepEqual(
      calls,
      [
        "retrieval",
        "selection",
        "assembly",
      ],
    );
    assert.equal(
      retrievalInput
        ?.workspaceSnapshotId,
      SNAPSHOT_ID,
    );
    assert.equal(
      retrievalInput
        ?.codeIndexChangeToken,
      "index-1",
    );
    assert.equal(
      result.status,
      "empty",
    );
    assert.deepEqual(
      result.statistics,
      {
        retrievedCandidates:
          0,
        selectedItems:
          0,
        assembledBlocks:
          0,
        droppedBlocks:
          0,
        usedTokens:
          0,
      },
    );
  },
);

test(
  "pipeline rejects repository intelligence from another snapshot",
  () => {
    const parsed =
      repositoryContextPipelineInputSchema
        .safeParse({
          workspace:
            "workspace",
          query:
            "Find authentication code",
          mode:
            "ask",
          snapshot,
          repoMap: {
            schemaVersion:
              1,
            workspaceSnapshotId:
              "b".repeat(
                64,
              ),
            codeIndexChangeToken:
              "index-1",
            entries:
              [],
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
              "2026-07-25T12:00:00.000Z",
          },
        });

    assert.equal(
      parsed.success,
      false,
    );
  },
);
