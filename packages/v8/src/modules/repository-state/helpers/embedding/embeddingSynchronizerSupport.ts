import {
  EMBEDDING_DEFAULTS,
  EMBEDDING_SCHEMA_VERSION,
} from "./constants";

import {
  embeddingSynchronizationResultSchema,
} from "./schema";

import type {
  EmbeddingProfile,
  EmbeddingSynchronizationResult,
  EmbeddingSynchronizationStatistics,
  EmbeddingSynchronizationWarning,
  EmbeddingSynchronizerInput,
  EmbeddingSynchronizerOptions,
  ResolvedEmbeddingSynchronizerOptions,
} from "./types";

export function createEmptySynchronizationStatistics():
  EmbeddingSynchronizationStatistics {
  return {
    changeBatchesRead: 0,
    writeBatchesApplied: 0,
    changesRead: 0,
    chunksEmbedded: 0,
    vectorsDeleted: 0,
    providerCalls: 0,
    truncatedInputs: 0,
  };
}

export function buildSynchronizationResult(
  input: {
    status:
      EmbeddingSynchronizationResult[
        "status"
      ];
    input:
      EmbeddingSynchronizerInput;
    profile:
      EmbeddingProfile;
    initialRevision:
      number;
    finalRevision:
      number;
    latestRevision:
      number;
    warnings:
      EmbeddingSynchronizationWarning[];
    statistics:
      EmbeddingSynchronizationStatistics;
  },
): EmbeddingSynchronizationResult {
  return embeddingSynchronizationResultSchema
    .parse({
      schemaVersion:
        EMBEDDING_SCHEMA_VERSION,
      status:
        input.status,
      workspace:
        input.input
          .workspace,
      rootId:
        input.input.rootId,
      profile:
        input.profile,
      initialTextRevision:
        input
          .initialRevision,
      finalTextRevision:
        input.finalRevision,
      latestTextRevision:
        input.latestRevision,
      warnings:
        input.warnings,
      statistics:
        input.statistics,
    }) as
    EmbeddingSynchronizationResult;
}

export function resolveSynchronizerOptions(
  options:
    EmbeddingSynchronizerOptions,
): ResolvedEmbeddingSynchronizerOptions {
  const resolved = {
    maximumChangesPerBatch:
      options
        .maximumChangesPerBatch ??
      EMBEDDING_DEFAULTS
        .MAXIMUM_CHANGES_PER_BATCH,
    maximumBatchesPerRun:
      options
        .maximumBatchesPerRun ??
      EMBEDDING_DEFAULTS
        .MAXIMUM_BATCHES_PER_RUN,
  };

  validatePositiveInteger(
    resolved
      .maximumChangesPerBatch,
    "maximumChangesPerBatch",
    EMBEDDING_DEFAULTS
      .MAXIMUM_ALLOWED_CHANGES_PER_BATCH,
  );

  validatePositiveInteger(
    resolved
      .maximumBatchesPerRun,
    "maximumBatchesPerRun",
    EMBEDDING_DEFAULTS
      .MAXIMUM_ALLOWED_BATCHES_PER_RUN,
  );

  return resolved;
}

export function validateSynchronizerInput(
  input:
    EmbeddingSynchronizerInput,
): void {
  if (
    !input.workspace.trim()
  ) {
    throw new RangeError(
      "workspace must not be empty.",
    );
  }

  if (!input.rootId.trim()) {
    throw new RangeError(
      "rootId must not be empty.",
    );
  }

  if (
    !Number.isSafeInteger(
      input.updatedAt,
    ) ||
    input.updatedAt < 0
  ) {
    throw new RangeError(
      "updatedAt must be a non-negative safe integer.",
    );
  }
}

function validatePositiveInteger(
  value: number,
  name: string,
  maximum: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new RangeError(
      `${name} must be a positive safe integer no greater than ${maximum}.`,
    );
  }
}
