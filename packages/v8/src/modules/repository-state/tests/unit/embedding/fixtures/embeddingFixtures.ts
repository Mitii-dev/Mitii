import type {
  Chunk,
} from "../../../../helpers/chunking/types";

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
} from "../../../../helpers/text-index/types";

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
} from "../../../../helpers/embedding/types";

export const PROFILE:
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

export class DeterministicProvider
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

export class InvalidDimensionProvider
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

export class MemoryTextIndex
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

export class MemoryVectorWriter
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

export function createChunk(
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

export function change(
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

