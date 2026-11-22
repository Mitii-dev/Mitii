import {
  embeddingIndexStateSchema,
  embeddingIndexWriteBatchSchema,
  embeddingIndexWriteResultSchema,
  embeddingProfileSchema,
} from "./schema";

import {
  EmbeddingError,
} from "./EmbeddingError";

import type {
  EmbeddingIndexState,
  EmbeddingIndexWriteBatch,
  EmbeddingIndexWriteResult,
  EmbeddingProfile,
  EmbeddingSynchronizerDependencies,
  EmbeddingSynchronizerInput,
  EmbeddingVectorRecord,
  ResolvedEmbeddingSynchronizerOptions,
} from "./types";

import type {
  TextIndexReadContext,
} from "../text-index/types";

/**
 * Text Index / vector writer access for the synchronizer: validated
 * reads and writes plus checkpoint and profile consistency assertions.
 */
export class EmbeddingSynchronizerGateway {
  constructor(
    private readonly dependencies:
      EmbeddingSynchronizerDependencies,

    private readonly options:
      ResolvedEmbeddingSynchronizerOptions,
  ) {}

  public getProfile():
    EmbeddingProfile {
    return embeddingProfileSchema
      .parse(
        this.dependencies
          .generator.profile,
      ) as
      EmbeddingProfile;
  }

  public async readState(
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

  public async readLatestRevision(
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

  public async readChanges(
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

  public async readChunks(
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

  public async writeBatch(
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

  public assertStateProfile(
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

  public assertWriteResult(
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
