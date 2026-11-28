import {
  EMBEDDING_IDS,
  EMBEDDING_MESSAGES,
  EMBEDDING_SCHEMA_VERSION,
} from "./constants";

import {
  embeddingGenerationResultSchema,
  embeddingProfileSchema,
} from "./schema";

import {
  EmbeddingError,
} from "./EmbeddingError";

import {
  EmbeddingTextPreparer,
} from "./EmbeddingTextPreparer";

import {
  EmbeddingVectorValidator,
} from "./EmbeddingVectorValidator";

import type {
  EmbeddingGenerationInput,
  EmbeddingGenerationResult,
  EmbeddingGenerationWarning,
  EmbeddingGeneratorOptions,
  EmbeddingProvider,
  EmbeddingVectorRecord,
  PreparedEmbeddingText,
  ResolvedEmbeddingGeneratorOptions,
} from "./types";

export class EmbeddingGenerator {
  public readonly id =
    EMBEDDING_IDS.GENERATOR;

  private readonly options:
    ResolvedEmbeddingGeneratorOptions;

  private readonly vectorCache:
    EmbeddingGeneratorOptions["vectorCache"];

  public get profile() {
    return this.provider.profile;
  }

  constructor(
    private readonly provider:
      EmbeddingProvider,

    options:
      EmbeddingGeneratorOptions = {},

    private readonly textPreparer =
      new EmbeddingTextPreparer(),

    private readonly vectorValidator =
      new EmbeddingVectorValidator(),
  ) {
    embeddingProfileSchema.parse(
      provider.profile,
    );

    this.options =
      this.textPreparer
        .resolveOptions(options);

    this.vectorCache =
      options.vectorCache;

    if (
      this.options
        .normalizeVectors !==
      provider.profile
        .normalized
    ) {
      throw new RangeError(
        "normalizeVectors must match EmbeddingProfile.normalized so the profile describes the stored vector space.",
      );
    }
  }

  public async generate(
    input:
      EmbeddingGenerationInput,
  ): Promise<EmbeddingGenerationResult> {
    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.cancelled(
        input.chunks.length,
        0,
        [],
      );
    }

    this.assertUniqueChunks(
      input.chunks,
    );

    const prepared =
      input.chunks.map(
        (chunk) =>
          this.textPreparer
            .prepare(
              chunk,
              this.options,
            ),
      );

    const warnings =
      this.createWarnings(
        prepared,
      );

    const records:
      EmbeddingVectorRecord[] =
      [];

    let providerCalls = 0;

    for (
      let start = 0;
      start < prepared.length;
      start +=
        this.options.batchSize
    ) {
      if (
        input.abortSignal
          ?.aborted
      ) {
        return this.cancelled(
          input.chunks.length,
          providerCalls,
          warnings,
        );
      }

      const batch =
        prepared.slice(
          start,
          start +
            this.options
              .batchSize,
        );

      let vectors:
        readonly (
          readonly number[]
        )[];

      try {
        const embedded =
          await this.embedBatch(
            batch,
            input.abortSignal,
          );

        vectors = embedded.vectors;
        providerCalls +=
          embedded.providerCalls;
      } catch (error) {
        if (
          input.abortSignal
            ?.aborted
        ) {
          return this.cancelled(
            input.chunks
              .length,
            providerCalls,
            warnings,
          );
        }

        throw this.normalizeError(
          error,
        );
      }

      if (
        input.abortSignal
          ?.aborted
      ) {
        return this.cancelled(
          input.chunks.length,
          providerCalls,
          warnings,
        );
      }

      if (
        vectors.length !==
        batch.length
      ) {
        throw new EmbeddingError(
          `Embedding provider returned ${vectors.length} vectors for ${batch.length} inputs.`,
          {
            operation:
              "generate",
            componentId:
              this.provider
                .profile
                .providerId,
          },
        );
      }

      for (
        let index = 0;
        index < batch.length;
        index += 1
      ) {
        const item =
          batch[index];
        const vector =
          vectors[index];

        if (
          !item ||
          !vector
        ) {
          throw new EmbeddingError(
            "Embedding provider response did not preserve input order.",
            {
              operation:
                "generate",
              componentId:
                this.provider
                  .profile
                  .providerId,
            },
          );
        }

        records.push(
          this.createRecord(
            item,
            vector,
          ),
        );
      }
    }

    return this.validate({
      schemaVersion:
        EMBEDDING_SCHEMA_VERSION,
      status: "complete",
      profile:
        this.provider.profile,
      records,
      warnings,
      statistics: {
        requestedChunks:
          input.chunks.length,
        embeddedChunks:
          records.length,
        providerCalls,
        truncatedInputs:
          warnings.length,
      },
    });
  }

  private async embedBatch(
    batch: readonly PreparedEmbeddingText[],
    abortSignal?: AbortSignal,
  ): Promise<{
    vectors: readonly (readonly number[])[];
    providerCalls: number;
  }> {
    const ordered:
      (readonly number[])[] =
      new Array(batch.length);

    const missingIndexes: number[] = [];
    const missingTexts: string[] = [];

    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index];
      if (!item) {
        continue;
      }

      const cached = await this.readCachedVector(
        item.chunk.contentHash,
      );

      if (cached) {
        ordered[index] = cached;
        continue;
      }

      missingIndexes.push(index);
      missingTexts.push(item.text);
    }

    if (missingTexts.length === 0) {
      return {
        vectors: ordered,
        providerCalls: 0,
      };
    }

    const vectors = await this.provider.embed(
      missingTexts,
      abortSignal ? { abortSignal } : {},
    );

    if (vectors.length !== missingTexts.length) {
      throw new EmbeddingError(
        `Embedding provider returned ${vectors.length} vectors for ${missingTexts.length} inputs.`,
        {
          operation: "generate",
          componentId: this.provider.profile.providerId,
        },
      );
    }

    for (let index = 0; index < missingIndexes.length; index += 1) {
      const batchIndex = missingIndexes[index];
      const vector = vectors[index];
      const item = batchIndex === undefined
        ? undefined
        : batch[batchIndex];

      if (
        batchIndex === undefined ||
        !vector ||
        !item
      ) {
        throw new EmbeddingError(
          "Embedding provider response did not preserve input order.",
          {
            operation: "generate",
            componentId: this.provider.profile.providerId,
          },
        );
      }

      ordered[batchIndex] = vector;
      await this.writeCachedVector(
        item.chunk.contentHash,
        vector,
      );
    }

    return {
      vectors: ordered,
      providerCalls: 1,
    };
  }

  private async readCachedVector(
    contentHash: string,
  ): Promise<readonly number[] | undefined> {
    if (!this.vectorCache) {
      return undefined;
    }

    const cached = await this.vectorCache.get(
      this.provider.profile.id,
      contentHash,
    );

    if (
      !cached ||
      cached.length !== this.provider.profile.dimensions
    ) {
      return undefined;
    }

    return cached;
  }

  private async writeCachedVector(
    contentHash: string,
    vector: readonly number[],
  ): Promise<void> {
    if (!this.vectorCache) {
      return;
    }

    await this.vectorCache.set(
      this.provider.profile.id,
      contentHash,
      vector,
    );
  }

  private createRecord(
    item: PreparedEmbeddingText,
    vector:
      readonly number[],
  ): EmbeddingVectorRecord {
    const chunk =
      item.chunk;

    return {
      chunkId:
        chunk.id,
      rootId:
        chunk.rootId,
      relativePath:
        chunk.relativePath,
      kind:
        chunk.kind,
      ordinal:
        chunk.ordinal,
      contentHash:
        chunk.contentHash,
      tokenEstimate:
        chunk.tokenEstimate,
      startLine:
        chunk.startLine,
      endLine:
        chunk.endLine,
      ...(chunk.title
        ? {
            title:
              chunk.title,
          }
        : {}),
      ...(chunk
        .symbolLocalId
        ? {
            symbolLocalId:
              chunk
                .symbolLocalId,
          }
        : {}),
      profileId:
        this.provider
          .profile.id,
      vector:
        this.vectorValidator
          .validate(
            vector,
            this.provider
              .profile,
            this.options
              .normalizeVectors,
          ),
    };
  }

  private createWarnings(
    prepared:
      readonly PreparedEmbeddingText[],
  ): EmbeddingGenerationWarning[] {
    return prepared
      .filter(
        (item) =>
          item.truncated,
      )
      .map((item) => ({
        code:
          "input_truncated",
        chunkId:
          item.chunk.id,
        message:
          EMBEDDING_MESSAGES
            .INPUT_TRUNCATED,
      }));
  }

  private assertUniqueChunks(
    chunks:
      EmbeddingGenerationInput[
        "chunks"
      ],
  ): void {
    const ids =
      new Set<string>();

    for (
      const chunk of chunks
    ) {
      if (
        ids.has(chunk.id)
      ) {
        throw new EmbeddingError(
          `Duplicate chunk ID "${chunk.id}" was supplied for embedding.`,
          {
            operation:
              "generate",
            componentId:
              this.id,
          },
        );
      }

      ids.add(chunk.id);
    }
  }

  private cancelled(
    requestedChunks: number,
    providerCalls: number,
    warnings:
      EmbeddingGenerationWarning[],
  ): EmbeddingGenerationResult {
    return this.validate({
      schemaVersion:
        EMBEDDING_SCHEMA_VERSION,
      status: "cancelled",
      profile:
        this.provider.profile,
      records: [],
      warnings,
      statistics: {
        requestedChunks,
        embeddedChunks: 0,
        providerCalls,
        truncatedInputs:
          warnings.length,
      },
    });
  }

  private normalizeError(
    error: unknown,
  ): EmbeddingError {
    if (
      error instanceof
      EmbeddingError
    ) {
      return error;
    }

    return new EmbeddingError(
      "Embedding provider failed to generate vectors.",
      {
        operation:
          "generate",
        componentId:
          this.provider
            .profile
            .providerId,
        cause: error,
      },
    );
  }

  private validate(
    result:
      EmbeddingGenerationResult,
  ): EmbeddingGenerationResult {
    return embeddingGenerationResultSchema
      .parse(result) as
      EmbeddingGenerationResult;
  }
}
