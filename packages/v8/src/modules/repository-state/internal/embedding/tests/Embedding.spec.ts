import assert from "node:assert/strict";
import test from "node:test";

import type {
  Chunk,
} from "../../chunking/types";

import type {
  NormalizedTextSearchRequest,
  TextIndexChange,
  TextIndexChangeQuery,
  TextIndexChangeQueryResult,
  TextIndexChunkQuery,
  TextIndexChunkQueryResult,
  TextIndexReadContext,
  TextIndexReadPort,
  TextIndexSearchPage,
} from "../../text-index/types";

import {
  EmbeddingError,
  EmbeddingFactory,
  EmbeddingGenerator,
} from "../index";

import type {
  EmbeddingIndexLocator,
  EmbeddingIndexState,
  EmbeddingIndexWriteBatch,
  EmbeddingIndexWriteContext,
  EmbeddingIndexWritePort,
  EmbeddingIndexWriteResult,
  EmbeddingProfile,
  EmbeddingProvider,
  EmbeddingProviderContext,
} from "../types";

const PROFILE:
  EmbeddingProfile = {
  id:
    "test:deterministic:4:l2",
  providerId:
    "deterministic-test",
  modelId:
    "test-model",
  dimensions: 4,
  normalized: true,
};

class DeterministicProvider
  implements EmbeddingProvider
{
  public readonly profile =
    PROFILE;

  public calls = 0;

  public async embed(
    texts: readonly string[],
    _context?:
      EmbeddingProviderContext,
  ): Promise<
    readonly (
      readonly number[]
    )[]
  > {
    this.calls += 1;

    return texts.map(
      (text) => [
        text.length || 1,
        2,
        3,
        4,
      ],
    );
  }
}

class InvalidDimensionProvider
  implements EmbeddingProvider
{
  public readonly profile =
    PROFILE;

  public async embed(
    texts: readonly string[],
  ): Promise<
    readonly (
      readonly number[]
    )[]
  > {
    return texts.map(
      () => [1, 2],
    );
  }
}

class MemoryTextIndex
  implements TextIndexReadPort
{
  public readonly id =
    "memory-text-index";

  constructor(
    private readonly revisions:
      readonly TextIndexChange[],
    private readonly chunks:
      ReadonlyMap<
        string,
        Chunk
      >,
    private readonly latestRevision:
      number,
  ) {}

  public async search(
    _request:
      NormalizedTextSearchRequest,
    _context?:
      TextIndexReadContext,
  ): Promise<TextIndexSearchPage> {
    return {
      matches: [],
      truncated: false,
    };
  }

  public async getChunks(
    query:
      TextIndexChunkQuery,
    _context?:
      TextIndexReadContext,
  ): Promise<TextIndexChunkQueryResult> {
    const selected =
      query.chunkIds.slice(
        0,
        query.maximumChunks,
      );

    return {
      chunks:
        selected.flatMap(
          (id) => {
            const chunk =
              this.chunks.get(id);

            return chunk
              ? [chunk]
              : [];
          },
        ),
      missingChunkIds:
        selected.filter(
          (id) =>
            !this.chunks.has(id),
        ),
      truncated:
        query.chunkIds
          .length >
        selected.length,
    };
  }

  public async getChanges(
    query:
      TextIndexChangeQuery,
    _context?:
      TextIndexReadContext,
  ): Promise<TextIndexChangeQueryResult> {
    const candidates =
      this.revisions.filter(
        (change) =>
          change.revision >
            query.afterRevision &&
          change.rootId ===
            query.rootId,
      );

    if (
      candidates.length === 0
    ) {
      return {
        changes: [],
        latestRevision:
          this.latestRevision,
        truncated: false,
      };
    }

    const selected:
      TextIndexChange[] = [];

    for (
      const change of
        candidates
    ) {
      const previousRevision =
        selected.at(-1)
          ?.revision;

      if (
        selected.length >=
          query.maximumChanges &&
        previousRevision !==
          change.revision
      ) {
        break;
      }

      selected.push(change);
    }

    return {
      changes: selected,
      latestRevision:
        this.latestRevision,
      truncated:
        selected.length <
        candidates.length,
    };
  }

  public async getRevision(
    _workspace: string,
    _rootId: string,
    _context?:
      TextIndexReadContext,
  ): Promise<number> {
    return this.latestRevision;
  }
}

class MemoryVectorWriter
  implements EmbeddingIndexWritePort
{
  public readonly id =
    "memory-vector-writer";

  public readonly records =
    new Map<
      string,
      EmbeddingIndexWriteBatch[
        "upserts"
      ][number]
    >();

  public readonly batches:
    EmbeddingIndexWriteBatch[] =
    [];

  private state:
    EmbeddingIndexState | null =
    null;

  public async getState(
    _locator:
      EmbeddingIndexLocator,
  ): Promise<
    EmbeddingIndexState | null
  > {
    return this.state;
  }

  public async applyBatch(
    batch:
      EmbeddingIndexWriteBatch,
    _context?:
      EmbeddingIndexWriteContext,
  ): Promise<EmbeddingIndexWriteResult> {
    const currentRevision =
      this.state
        ?.textRevision ?? 0;

    if (
      currentRevision !==
      batch
        .expectedTextRevision
    ) {
      throw new Error(
        "Optimistic revision mismatch.",
      );
    }

    for (
      const chunkId of
        batch.deleteChunkIds
    ) {
      this.records.delete(
        chunkId,
      );
    }

    for (
      const record of
        batch.upserts
    ) {
      this.records.set(
        record.chunkId,
        record,
      );
    }

    this.batches.push(batch);

    this.state = {
      workspace:
        batch.workspace,
      rootId:
        batch.rootId,
      profileId:
        batch.profileId,
      providerId:
        batch.profile
          .providerId,
      modelId:
        batch.profile.modelId,
      dimensions:
        batch.profile
          .dimensions,
      normalized:
        batch.profile
          .normalized,
      textRevision:
        batch
          .nextTextRevision,
      updatedAt:
        batch.updatedAt,
    };

    return {
      action: "applied",
      previousTextRevision:
        currentRevision,
      textRevision:
        batch
          .nextTextRevision,
      vectorsUpserted:
        batch.upserts.length,
      vectorsDeleted:
        batch.deleteChunkIds
          .length,
    };
  }
}

function createChunk(
  id: string,
  content: string,
): Chunk {
  return {
    id,
    sourceId:
      `source:${id}`,
    rootId: "root",
    relativePath:
      `src/${id}.ts`,
    strategyId: "code",
    ordinal: 0,
    kind: "code_region",
    content,
    sourceContentHash:
      "a".repeat(64),
    contentHash:
      "b".repeat(64),
    tokenEstimate: 10,
    startOffset: 0,
    endOffset:
      content.length,
    startLine: 1,
    endLine: 1,
    title: id,
  };
}

function change(
  revision: number,
  kind:
    TextIndexChange[
      "kind"
    ],
  chunkId: string,
): TextIndexChange {
  return {
    revision,
    kind,
    chunkId,
    rootId: "root",
    relativePath:
      `src/${chunkId}.ts`,
    changedAt:
      revision * 100,
  };
}

test(
  "generates bounded normalized vectors in deterministic batches",
  async () => {
    const provider =
      new DeterministicProvider();

    const generator =
      new EmbeddingGenerator(
        provider,
        {
          batchSize: 1,
          maximumInputCharacters:
            12,
        },
      );

    const result =
      await generator.generate({
        chunks: [
          createChunk(
            "first",
            "long content that is truncated",
          ),
          createChunk(
            "second",
            "short",
          ),
        ],
      });

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.records.length,
      2,
    );
    assert.equal(
      provider.calls,
      2,
    );
    assert.equal(
      result.statistics
        .truncatedInputs,
      2,
    );

    for (
      const record of
        result.records
    ) {
      const norm =
        Math.sqrt(
          record.vector.reduce(
            (sum, value) =>
              sum +
              value * value,
            0,
          ),
        );

      assert.ok(
        Math.abs(norm - 1) <
          1e-10,
      );
    }
  },
);

test(
  "rejects provider vectors with incompatible dimensions",
  async () => {
    const generator =
      new EmbeddingGenerator(
        new InvalidDimensionProvider(),
      );

    await assert.rejects(
      () =>
        generator.generate({
          chunks: [
            createChunk(
              "bad",
              "bad vector",
            ),
          ],
        }),
      EmbeddingError,
    );
  },
);

test(
  "synchronizes Text Index changes and resumes from its checkpoint",
  async () => {
    const first =
      createChunk(
        "first",
        "authentication token",
      );
    const second =
      createChunk(
        "second",
        "authorization policy",
      );

    const textIndex =
      new MemoryTextIndex(
        [
          change(
            1,
            "upsert",
            first.id,
          ),
          change(
            2,
            "upsert",
            second.id,
          ),
        ],
        new Map([
          [first.id, first],
          [second.id, second],
        ]),
        2,
      );

    const writer =
      new MemoryVectorWriter();

    const embedding =
      new EmbeddingFactory()
        .create({
          provider:
            new DeterministicProvider(),
          textIndex,
          vectorWriter:
            writer,
        });

    const firstRun =
      await embedding
        .synchronizer
        .synchronize({
          workspace:
            "/repo",
          rootId: "root",
          updatedAt: 1_000,
        });

    const secondRun =
      await embedding
        .synchronizer
        .synchronize({
          workspace:
            "/repo",
          rootId: "root",
          updatedAt: 2_000,
        });

    assert.equal(
      firstRun.status,
      "complete",
    );
    assert.equal(
      firstRun
        .finalTextRevision,
      2,
    );
    assert.equal(
      writer.records.size,
      2,
    );
    assert.equal(
      secondRun.status,
      "unchanged",
    );
    assert.equal(
      writer.batches.length,
      1,
    );
  },
);

test(
  "turns missing upsert chunks into vector deletions",
  async () => {
    const writer =
      new MemoryVectorWriter();

    const embedding =
      new EmbeddingFactory()
        .create({
          provider:
            new DeterministicProvider(),
          textIndex:
            new MemoryTextIndex(
              [
                change(
                  1,
                  "upsert",
                  "missing",
                ),
              ],
              new Map(),
              1,
            ),
          vectorWriter:
            writer,
        });

    const result =
      await embedding
        .synchronizer
        .synchronize({
          workspace:
            "/repo",
          rootId: "root",
          updatedAt: 100,
        });

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.warnings[0]
        ?.code,
      "missing_upsert_chunk",
    );
    assert.deepEqual(
      writer.batches[0]
        ?.deleteChunkIds,
      ["missing"],
    );
  },
);

test(
  "advances across Text Index revisions that contain no chunks",
  async () => {
    const writer =
      new MemoryVectorWriter();

    const embedding =
      new EmbeddingFactory()
        .create({
          provider:
            new DeterministicProvider(),
          textIndex:
            new MemoryTextIndex(
              [],
              new Map(),
              1,
            ),
          vectorWriter:
            writer,
        });

    const result =
      await embedding
        .synchronizer
        .synchronize({
          workspace:
            "/repo",
          rootId: "root",
          updatedAt: 100,
        });

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.finalTextRevision,
      1,
    );
    assert.equal(
      writer.batches.length,
      1,
    );
    assert.equal(
      writer.batches[0]
        ?.upserts.length,
      0,
    );
    assert.equal(
      writer.batches[0]
        ?.deleteChunkIds
        .length,
      0,
    );
  },
);

test(
  "returns partial when the configured synchronization batch limit is reached",
  async () => {
    const first =
      createChunk(
        "first",
        "first",
      );
    const second =
      createChunk(
        "second",
        "second",
      );

    const embedding =
      new EmbeddingFactory()
        .create(
          {
            provider:
              new DeterministicProvider(),
            textIndex:
              new MemoryTextIndex(
                [
                  change(
                    1,
                    "upsert",
                    first.id,
                  ),
                  change(
                    2,
                    "upsert",
                    second.id,
                  ),
                ],
                new Map([
                  [
                    first.id,
                    first,
                  ],
                  [
                    second.id,
                    second,
                  ],
                ]),
                2,
              ),
            vectorWriter:
              new MemoryVectorWriter(),
          },
          {
            synchronizer: {
              maximumChangesPerBatch:
                1,
              maximumBatchesPerRun:
                1,
            },
          },
        );

    const result =
      await embedding
        .synchronizer
        .synchronize({
          workspace:
            "/repo",
          rootId: "root",
          updatedAt: 100,
        });

    assert.equal(
      result.status,
      "partial",
    );
    assert.equal(
      result.finalTextRevision,
      1,
    );
    assert.equal(
      result.latestTextRevision,
      2,
    );
    assert.equal(
      result.warnings.at(-1)
        ?.code,
      "batch_limit_reached",
    );
  },
);
