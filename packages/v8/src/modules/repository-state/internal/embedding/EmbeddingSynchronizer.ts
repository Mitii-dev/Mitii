import {
  EMBEDDING_DEFAULTS,
  EMBEDDING_IDS,
  EMBEDDING_MESSAGES,
  EMBEDDING_SCHEMA_VERSION,
} from "./constants";

import {
  embeddingIndexStateSchema,
  embeddingIndexWriteBatchSchema,
  embeddingIndexWriteResultSchema,
  embeddingProfileSchema,
  embeddingSynchronizationResultSchema,
} from "./schema";

import {
  EmbeddingChangePlanner,
} from "./EmbeddingChangePlanner";

import {
  EmbeddingError,
} from "./EmbeddingError";

import type {
  EmbeddingChangePlan,
  EmbeddingIndexWriteBatch,
  EmbeddingIndexState,
  EmbeddingIndexWriteResult,
  EmbeddingProfile,
  EmbeddingSynchronizationResult,
  EmbeddingSynchronizationStatistics,
  EmbeddingSynchronizationWarning,
  EmbeddingSynchronizerDependencies,
  EmbeddingSynchronizerInput,
  EmbeddingSynchronizerOptions,
  EmbeddingVectorRecord,
  ResolvedEmbeddingSynchronizerOptions,
} from "./types";

import type {
  TextIndexReadContext,
} from "../text-index/types";

export class EmbeddingSynchronizer {
  public readonly id =
    EMBEDDING_IDS.SYNCHRONIZER;

  private readonly options:
    ResolvedEmbeddingSynchronizerOptions;

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
      this.resolveOptions(
        options,
      );

    this.planner =
      dependencies.planner ??
      new EmbeddingChangePlanner();
  }

  public async synchronize(
    input:
      EmbeddingSynchronizerInput,
  ): Promise<EmbeddingSynchronizationResult> {
    this.validateInput(input);

    const profile =
      this.getProfile();

    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.result({
        status: "cancelled",
        input,
        profile,
        initialRevision: 0,
        finalRevision: 0,
        latestRevision: 0,
        warnings: [],
        statistics:
          this.emptyStatistics(),
      });
    }

    const state =
      await this.readState(
        input,
        profile.id,
      );

    this.assertStateProfile(
      state,
      profile,
    );

    const initialRevision =
      state?.textRevision ?? 0;

    let currentRevision =
      initialRevision;

    let latestRevision =
      await this.readLatestRevision(
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
      this.emptyStatistics();

    if (
      currentRevision ===
      latestRevision
    ) {
      return this.result({
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
        return this.result({
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
        await this.readChanges(
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
            await this.writeBatch(
              input,
              profile,
              currentRevision,
              latestRevision,
              [],
              [],
            );

          this.assertWriteResult(
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

        return this.result({
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
        await this.readChunks(
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
        return this.result({
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
        await this.writeBatch(
          input,
          profile,
          currentRevision,
          plan
            .nextTextRevision,
          generation.records,
          [...deleteIds].sort(),
        );

      this.assertWriteResult(
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
        return this.result({
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
        await this.readLatestRevision(
          input,
        ),
      );

    if (
      currentRevision >=
      latestRevision
    ) {
      return this.result({
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

    return this.result({
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

  private getProfile():
    EmbeddingProfile {
    return embeddingProfileSchema
      .parse(
        this.dependencies
          .generator.profile,
      ) as
      EmbeddingProfile;
  }

  private async readState(
    input:
      EmbeddingSynchronizerInput,
    profileId: string,
  ): Promise<
    EmbeddingIndexState | null
  > {
    try {
      const state =
        await this.dependencies
          .vectorWriter
          .getState(
            {
              workspace:
                input.workspace,
              rootId:
                input.rootId,
              profileId,
            },
            this.contextOf(
              input,
            ),
          );

      return state
        ? embeddingIndexStateSchema
            .parse(
              state,
            ) as
            EmbeddingIndexState
        : null;
    } catch (error) {
      throw this.normalizeError(
        error,
        "read_index_state",
        this.dependencies
          .vectorWriter.id,
      );
    }
  }

  private async readLatestRevision(
    input:
      EmbeddingSynchronizerInput,
  ): Promise<number> {
    try {
      return await this.dependencies
        .textIndex
        .getRevision(
          input.workspace,
          input.rootId,
          this.contextOf(
            input,
          ),
        );
    } catch (error) {
      throw this.normalizeError(
        error,
        "read_text_revision",
        this.dependencies
          .textIndex.id,
      );
    }
  }

  private async readChanges(
    input:
      EmbeddingSynchronizerInput,
    afterRevision: number,
  ) {
    try {
      return await this.dependencies
        .textIndex
        .getChanges(
          {
            workspace:
              input.workspace,
            rootId:
              input.rootId,
            afterRevision,
            maximumChanges:
              this.options
                .maximumChangesPerBatch,
          },
          this.contextOf(
            input,
          ),
        );
    } catch (error) {
      throw this.normalizeError(
        error,
        "read_text_changes",
        this.dependencies
          .textIndex.id,
      );
    }
  }

  private async readChunks(
    input:
      EmbeddingSynchronizerInput,
    chunkIds:
      readonly string[],
  ) {
    try {
      return await this.dependencies
        .textIndex
        .getChunks(
          {
            workspace:
              input.workspace,
            chunkIds,
            maximumChunks:
              Math.max(
                1,
                chunkIds.length,
              ),
          },
          this.contextOf(
            input,
          ),
        );
    } catch (error) {
      throw this.normalizeError(
        error,
        "read_chunks",
        this.dependencies
          .textIndex.id,
      );
    }
  }

  private async writeBatch(
    input:
      EmbeddingSynchronizerInput,
    profile:
      EmbeddingProfile,
    expectedTextRevision:
      number,
    nextTextRevision: number,
    upserts:
      readonly EmbeddingVectorRecord[],
    deleteChunkIds:
      readonly string[],
  ): Promise<EmbeddingIndexWriteResult> {
    try {
      const result =
        await this.dependencies
          .vectorWriter
          .applyBatch(
            embeddingIndexWriteBatchSchema
              .parse({
              workspace:
                input.workspace,
              rootId:
                input.rootId,
              profileId:
                profile.id,
              profile,
              expectedTextRevision,
              nextTextRevision,
              upserts,
              deleteChunkIds,
              updatedAt:
                input.updatedAt,
            }) as
              EmbeddingIndexWriteBatch,
            this.contextOf(
              input,
            ),
          );

      return embeddingIndexWriteResultSchema
        .parse(result) as
        EmbeddingIndexWriteResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "write_vectors",
        this.dependencies
          .vectorWriter.id,
      );
    }
  }

  private assertStateProfile(
    state:
      EmbeddingIndexState | null,
    profile:
      EmbeddingProfile,
  ): void {
    if (!state) {
      return;
    }

    if (
      state.profileId !==
        profile.id ||
      state.providerId !==
        profile.providerId ||
      state.modelId !==
        profile.modelId ||
      state.dimensions !==
        profile.dimensions ||
      state.normalized !==
        profile.normalized
    ) {
      throw new EmbeddingError(
        `Embedding profile ID "${profile.id}" collides with incompatible stored metadata.`,
        {
          operation:
            "read_index_state",
          componentId:
            this.dependencies
              .vectorWriter.id,
        },
      );
    }
  }

  private assertWriteResult(
    result:
      EmbeddingIndexWriteResult,
    expectedRevision: number,
    nextRevision: number,
  ): void {
    if (
      result
        .previousTextRevision !==
        expectedRevision ||
      result.textRevision !==
        nextRevision
    ) {
      throw new EmbeddingError(
        "Vector writer returned an unexpected Text Index checkpoint.",
        {
          operation:
            "write_vectors",
          componentId:
            this.dependencies
              .vectorWriter.id,
        },
      );
    }
  }

  private contextOf(
    input:
      EmbeddingSynchronizerInput,
  ): TextIndexReadContext {
    return {
      ...(input.abortSignal
        ? {
            abortSignal:
              input.abortSignal,
          }
        : {}),
    };
  }

  private emptyStatistics():
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

  private result(
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

  private resolveOptions(
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

    this.validateInteger(
      resolved
        .maximumChangesPerBatch,
      "maximumChangesPerBatch",
      EMBEDDING_DEFAULTS
        .MAXIMUM_ALLOWED_CHANGES_PER_BATCH,
    );

    this.validateInteger(
      resolved
        .maximumBatchesPerRun,
      "maximumBatchesPerRun",
      EMBEDDING_DEFAULTS
        .MAXIMUM_ALLOWED_BATCHES_PER_RUN,
    );

    return resolved;
  }

  private validateInput(
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

  private validateInteger(
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

  private normalizeError(
    error: unknown,
    operation:
      ConstructorParameters<
        typeof EmbeddingError
      >[1]["operation"],
    componentId: string,
  ): EmbeddingError {
    if (
      error instanceof
      EmbeddingError
    ) {
      return error;
    }

    return new EmbeddingError(
      "Embedding synchronization failed.",
      {
        operation,
        componentId,
        cause: error,
      },
    );
  }
}
