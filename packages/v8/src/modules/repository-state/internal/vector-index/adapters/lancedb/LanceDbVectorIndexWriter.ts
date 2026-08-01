import {
  embeddingIndexStateSchema,
  embeddingIndexWriteBatchSchema,
  embeddingIndexWriteResultSchema,
} from "../../../embedding/schema";

import {
  VECTOR_INDEX_IDS,
  VECTOR_INDEX_LANCEDB,
} from "../../constants";

import {
  KeyedAsyncLock,
} from "../../KeyedAsyncLock";

import {
  throwIfVectorIndexAborted,
  VectorIndexRevisionMismatchError,
} from "../../VectorIndexError";

import {
  LanceDbFilterBuilder,
} from "./LanceDbFilterBuilder";

import {
  LanceDbProfileGuard,
} from "./LanceDbProfileGuard";

import {
  LanceDbRowMapper,
} from "./LanceDbRowMapper";

import {
  LanceDbTableManager,
} from "./LanceDbTableManager";

import type {
  EmbeddingIndexLocator,
  EmbeddingIndexReadContext,
  EmbeddingIndexState,
  EmbeddingIndexWriteBatch,
  EmbeddingIndexWriteContext,
  EmbeddingIndexWritePort,
  EmbeddingIndexWriteResult,
} from "../../../embedding/types";

import type {
  LanceDbTablePort,
} from "../../types";

export class LanceDbVectorIndexWriter
  implements EmbeddingIndexWritePort
{
  public readonly id =
    VECTOR_INDEX_IDS
      .LANCEDB_WRITER;

  constructor(
    private readonly tableManager:
      LanceDbTableManager,
    private readonly rowMapper =
      new LanceDbRowMapper(),
    private readonly filterBuilder =
      new LanceDbFilterBuilder(),
    private readonly profileGuard =
      new LanceDbProfileGuard(),
    private readonly lock =
      new KeyedAsyncLock(),
  ) {}

  public async getState(
    locator: EmbeddingIndexLocator,
    context:
      EmbeddingIndexReadContext = {},
  ): Promise<
    EmbeddingIndexState | null
  > {
    throwIfVectorIndexAborted(
      context.abortSignal,
      "read_state",
      this.id,
    );

    const table =
      await this.tableManager
        .openExisting(
          locator.profileId,
        );

    if (!table) {
      return null;
    }

    const state =
      await this.readState(
        table,
        locator,
      );

    throwIfVectorIndexAborted(
      context.abortSignal,
      "read_state",
      this.id,
    );

    return state;
  }

  public async applyBatch(
    input: EmbeddingIndexWriteBatch,
    context:
      EmbeddingIndexWriteContext = {},
  ): Promise<EmbeddingIndexWriteResult> {
    const batch =
      embeddingIndexWriteBatchSchema
        .parse(input) as
        EmbeddingIndexWriteBatch;

    throwIfVectorIndexAborted(
      context.abortSignal,
      "write_batch",
      this.id,
    );

    const lockKey =
      [
        this.tableManager
          .tableName(
            batch.profileId,
          ),
        batch.workspace,
        batch.rootId,
      ].join(
        VECTOR_INDEX_LANCEDB
          .RECORD_KEY_SEPARATOR,
      );

    return this.lock
      .runExclusive(
        lockKey,
        async () =>
          this.applyLocked(
            batch,
            context,
          ),
      );
  }

  private async applyLocked(
    batch: EmbeddingIndexWriteBatch,
    context:
      EmbeddingIndexWriteContext,
  ): Promise<EmbeddingIndexWriteResult> {
    throwIfVectorIndexAborted(
      context.abortSignal,
      "write_batch",
      this.id,
    );

    let table =
      await this.tableManager
        .openExisting(
          batch.profileId,
        );

    if (table) {
      await this.profileGuard
        .assertProfile(
          table,
          batch.profile,
        );
    }

    const state =
      table
        ? await this.readState(
            table,
            batch,
          )
        : null;

    const actualTextRevision =
      state?.textRevision ?? 0;

    if (
      actualTextRevision !==
      batch.expectedTextRevision
    ) {
      throw new VectorIndexRevisionMismatchError(
        {
          expectedTextRevision:
            batch
              .expectedTextRevision,
          actualTextRevision,
        },
        {
          operation:
            "write_batch",
          componentId:
            this.id,
        },
      );
    }

    const rows =
      this.rowMapper
        .toWriteRows(batch);

    throwIfVectorIndexAborted(
      context.abortSignal,
      "write_batch",
      this.id,
    );

    if (!table) {
      table =
        await this.tableManager
          .create(
            batch.profile,
            rows,
          );
    } else {
      await table
        .mergeInsert(
          VECTOR_INDEX_LANCEDB
            .MERGE_KEY_COLUMN,
        )
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute(rows);
    }

    throwIfVectorIndexAborted(
      context.abortSignal,
      "write_batch",
      this.id,
    );

    const result:
      EmbeddingIndexWriteResult = {
        action:
          "applied",
        previousTextRevision:
          actualTextRevision,
        textRevision:
          batch.nextTextRevision,
        vectorsUpserted:
          batch.upserts.length,
        vectorsDeleted:
          batch
            .deleteChunkIds
            .length,
      };

    return embeddingIndexWriteResultSchema
      .parse(result) as
      EmbeddingIndexWriteResult;
  }

  private async readState(
    table: LanceDbTablePort,
    locator: EmbeddingIndexLocator,
  ): Promise<
    EmbeddingIndexState | null
  > {
    const rows =
      await table.query()
        .where(
          this.filterBuilder
            .buildStateFilter(
              locator.workspace,
              locator.rootId,
              locator.profileId,
            ),
        )
        .select([
          ...VECTOR_INDEX_LANCEDB
            .STATE_COLUMNS,
        ])
        .limit(2)
        .toArray();

    if (rows.length === 0) {
      return null;
    }

    if (rows.length > 1) {
      throw new Error(
        "Vector Index contains duplicate state rows for one locator.",
      );
    }

    const state =
      this.rowMapper
        .toIndexState(
          rows[0],
        );

    return embeddingIndexStateSchema
      .parse(state) as
      EmbeddingIndexState;
  }
}
