import {
  EMBEDDING_IDS,
  EMBEDDING_MESSAGES,
} from "./constants";

import {
  EmbeddingChangePlanner,
} from "./EmbeddingChangePlanner";

import {
  EmbeddingError,
} from "./EmbeddingError";

import {
  EmbeddingSynchronizerGateway,
} from "./EmbeddingSynchronizerGateway";

import {
  buildSynchronizationResult,
  createEmptySynchronizationStatistics,
  resolveSynchronizerOptions,
  validateSynchronizerInput,
} from "./embeddingSynchronizerSupport";

import type {
  EmbeddingChangePlan,
  EmbeddingSynchronizationResult,
  EmbeddingSynchronizationWarning,
  EmbeddingSynchronizerDependencies,
  EmbeddingSynchronizerInput,
  EmbeddingSynchronizerOptions,
  ResolvedEmbeddingSynchronizerOptions,
} from "./types";

export class EmbeddingSynchronizer {
  public readonly id =
    EMBEDDING_IDS.SYNCHRONIZER;

  private readonly options:
    ResolvedEmbeddingSynchronizerOptions;

  private readonly gateway:
    EmbeddingSynchronizerGateway;

  private readonly planner: {
    plan(
      input: Parameters<
        EmbeddingChangePlanner[
          "plan"
        ]
      >[0],
    ): EmbeddingChangePlan;
  };

  constructor(
    private readonly dependencies:
      EmbeddingSynchronizerDependencies,

    options:
      EmbeddingSynchronizerOptions = {},
  ) {
    this.options =
      resolveSynchronizerOptions(
        options,
      );

    this.gateway =
      new EmbeddingSynchronizerGateway(
        dependencies,
        this.options,
      );

    this.planner =
      dependencies.planner ??
      new EmbeddingChangePlanner();
  }

  public async synchronize(
    input:
      EmbeddingSynchronizerInput,
  ): Promise<EmbeddingSynchronizationResult> {
    validateSynchronizerInput(input);

    const profile =
      this.gateway.getProfile();

    if (
      input.abortSignal
        ?.aborted
    ) {
      return buildSynchronizationResult({
        status: "cancelled",
        input,
        profile,
        initialRevision: 0,
        finalRevision: 0,
        latestRevision: 0,
        warnings: [],
        statistics:
          createEmptySynchronizationStatistics(),
      });
    }

    const state =
      await this.gateway.readState(
        input,
        profile.id,
      );

    this.gateway.assertStateProfile(
      state,
      profile,
    );

    const initialRevision =
      state?.textRevision ?? 0;

    let currentRevision =
      initialRevision;

    let latestRevision =
      await this.gateway.readLatestRevision(
        input,
      );

    if (
      currentRevision >
      latestRevision
    ) {
      throw new EmbeddingError(
        `Vector checkpoint ${currentRevision} is ahead of Text Index revision ${latestRevision}.`,
        {
          operation:
            "read_text_revision",
          componentId:
            this.id,
        },
      );
    }

    const warnings:
      EmbeddingSynchronizationWarning[] =
      [];

    const statistics =
      createEmptySynchronizationStatistics();

    if (
      currentRevision ===
      latestRevision
    ) {
      return buildSynchronizationResult({
        status: "unchanged",
        input,
        profile,
        initialRevision,
        finalRevision:
          currentRevision,
        latestRevision,
        warnings,
        statistics,
      });
    }

    for (
      let batchNumber = 0;
      batchNumber <
      this.options
        .maximumBatchesPerRun;
      batchNumber += 1
    ) {
      if (
        input.abortSignal
          ?.aborted
      ) {
        return buildSynchronizationResult({
          status:
            "cancelled",
          input,
          profile,
          initialRevision,
          finalRevision:
            currentRevision,
          latestRevision,
          warnings,
          statistics,
        });
      }

      const changes =
        await this.gateway.readChanges(
          input,
          currentRevision,
        );

      statistics
        .changeBatchesRead += 1;
      statistics.changesRead +=
        changes.changes.length;

      latestRevision =
        Math.max(
          latestRevision,
          changes
            .latestRevision,
        );

      if (
        changes.changes
          .length === 0
      ) {
        if (
          currentRevision <
          latestRevision
        ) {
          const write =
            await this.gateway.writeBatch(
              input,
              profile,
              currentRevision,
              latestRevision,
              [],
              [],
            );

          this.gateway.assertWriteResult(
            write,
            currentRevision,
            latestRevision,
          );

          statistics
            .writeBatchesApplied +=
            1;

          currentRevision =
            latestRevision;
        }

        return buildSynchronizationResult({
          status: "complete",
          input,
          profile,
          initialRevision,
          finalRevision:
            currentRevision,
          latestRevision,
          warnings,
          statistics,
        });
      }

      const plan =
        this.planner.plan({
          changes:
            changes.changes,
          currentTextRevision:
            currentRevision,
        });

      if (
        plan.nextTextRevision <=
        currentRevision
      ) {
        throw new EmbeddingError(
          "Embedding change plan did not advance the Text Index revision.",
          {
            operation:
              "read_text_changes",
            componentId:
              this.id,
          },
        );
      }

      const chunkResult =
        await this.gateway.readChunks(
          input,
          plan.upsertChunkIds,
        );

      if (
        chunkResult.truncated
      ) {
        throw new EmbeddingError(
          "Text Index truncated an embedding chunk lookup.",
          {
            operation:
              "read_chunks",
            componentId:
              this.dependencies
                .textIndex.id,
          },
        );
      }

      for (
        const chunk of
          chunkResult.chunks
      ) {
        if (
          chunk.rootId !==
          input.rootId
        ) {
          throw new EmbeddingError(
            `Text Index returned chunk "${chunk.id}" from unexpected root "${chunk.rootId}".`,
            {
              operation:
                "read_chunks",
              componentId:
                this.dependencies
                  .textIndex.id,
            },
          );
        }
      }

      const deleteIds =
        new Set(
          plan.deleteChunkIds,
        );

      for (
        const missingId of
          chunkResult
            .missingChunkIds
      ) {
        deleteIds.add(
          missingId,
        );

        warnings.push({
          code:
            "missing_upsert_chunk",
          chunkId:
            missingId,
          message:
            EMBEDDING_MESSAGES
              .MISSING_UPSERT_CHUNK,
        });
      }

      const generation =
        await this.dependencies
          .generator
          .generate({
            chunks:
              chunkResult.chunks,
            ...(input.abortSignal
              ? {
                  abortSignal:
                    input
                      .abortSignal,
                }
              : {}),
          });

      statistics.providerCalls +=
        generation.statistics
          .providerCalls;
      statistics
        .truncatedInputs +=
        generation.statistics
          .truncatedInputs;

      for (
        const warning of
          generation.warnings
      ) {
        warnings.push({
          code:
            "input_truncated",
          chunkId:
            warning.chunkId,
          message:
            warning.message,
        });
      }

      if (
        generation.status ===
        "cancelled"
      ) {
        return buildSynchronizationResult({
          status:
            "cancelled",
          input,
          profile,
          initialRevision,
          finalRevision:
            currentRevision,
          latestRevision,
          warnings,
          statistics,
        });
      }

      const write =
        await this.gateway.writeBatch(
          input,
          profile,
          currentRevision,
          plan
            .nextTextRevision,
          generation.records,
          [...deleteIds].sort(),
        );

      this.gateway.assertWriteResult(
        write,
        currentRevision,
        plan.nextTextRevision,
      );

      statistics
        .writeBatchesApplied += 1;
      statistics
        .chunksEmbedded +=
        write.vectorsUpserted;
      statistics
        .vectorsDeleted +=
        write.vectorsDeleted;

      currentRevision =
        write.textRevision;

      if (
        currentRevision >=
        latestRevision &&
        !changes.truncated
      ) {
        return buildSynchronizationResult({
          status: "complete",
          input,
          profile,
          initialRevision,
          finalRevision:
            currentRevision,
          latestRevision:
            currentRevision,
          warnings,
          statistics,
        });
      }
    }

    latestRevision =
      Math.max(
        latestRevision,
        await this.gateway.readLatestRevision(
          input,
        ),
      );

    if (
      currentRevision >=
      latestRevision
    ) {
      return buildSynchronizationResult({
        status: "complete",
        input,
        profile,
        initialRevision,
        finalRevision:
          currentRevision,
        latestRevision:
          currentRevision,
        warnings,
        statistics,
      });
    }

    warnings.push({
      code:
        "batch_limit_reached",
      message:
        EMBEDDING_MESSAGES
          .BATCH_LIMIT_REACHED,
    });

    return buildSynchronizationResult({
      status: "partial",
      input,
      profile,
      initialRevision,
      finalRevision:
        currentRevision,
      latestRevision,
      warnings,
      statistics,
    });
  }
}
