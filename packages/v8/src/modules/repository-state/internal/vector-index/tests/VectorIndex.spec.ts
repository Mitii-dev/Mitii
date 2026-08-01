import assert from "node:assert/strict";
import test from "node:test";

import type {
  EmbeddingIndexWriteBatch,
  EmbeddingProfile,
} from "../../embedding/types";

import {
  LanceDbTableManager,
  LanceDbVectorIndexReader,
  LanceDbVectorIndexWriter,
  VectorIndexRevisionMismatchError,
  VectorIndexTableNameBuilder,
  VectorSearchRequestNormalizer,
  VectorSearchService,
} from "../index";

import type {
  LanceDbConnectionPort,
  LanceDbMergeInsertPort,
  LanceDbMergeInsertResult,
  LanceDbQueryPort,
  LanceDbRow,
  LanceDbTablePort,
  LanceDbVectorQueryPort,
} from "../types";

const PROFILE:
  EmbeddingProfile = {
  id:
    "test:vector:2:l2",
  providerId:
    "test-provider",
  modelId:
    "test-model",
  dimensions:
    2,
  normalized:
    true,
};

class FakeQuery
  implements LanceDbVectorQueryPort
{
  private predicate = "";
  private maximumRows =
    Number.MAX_SAFE_INTEGER;

  constructor(
    private readonly rows:
      () => LanceDbRow[],
    private readonly vector?:
      number[],
    private readonly onPredicate?:
      (predicate: string) => void,
  ) {}

  public where(
    predicate: string,
  ): this {
    this.predicate =
      predicate;
    this.onPredicate?.(
      predicate,
    );

    return this;
  }

  public select(
    _columns: readonly string[],
  ): this {
    return this;
  }

  public limit(
    limit: number,
  ): this {
    this.maximumRows =
      limit;

    return this;
  }

  public column(
    _column: string,
  ): this {
    return this;
  }

  public distanceType(
    _distanceType: "cosine",
  ): this {
    return this;
  }

  public nprobes(
    _value: number,
  ): this {
    return this;
  }

  public refineFactor(
    _value: number,
  ): this {
    return this;
  }

  public async toArray():
    Promise<unknown[]> {
    let selected =
      this.rows()
        .filter(
          (row) =>
            this.matches(row),
        );

    if (this.vector) {
      selected =
        selected
          .map(
            (row) => ({
              ...row,
              _distance:
                this.cosineDistance(
                  this.vector as number[],
                  row.vector as
                    number[],
                ),
            }),
          )
          .sort(
            (left, right) =>
              Number(
                left._distance,
              ) -
              Number(
                right._distance,
              ),
          );
    }

    return selected.slice(
      0,
      this.maximumRows,
    );
  }

  private matches(
    row: LanceDbRow,
  ): boolean {
    if (
      this.predicate.includes(
        "row_type = 'state'",
      ) &&
      row.row_type !==
        "state"
    ) {
      return false;
    }

    if (
      this.predicate.includes(
        "row_type = 'vector'",
      ) &&
      row.row_type !==
        "vector"
    ) {
      return false;
    }

    if (
      this.predicate.includes(
        "active = true",
      ) &&
      row.active !== true
    ) {
      return false;
    }

    for (
      const [column, value] of
        [
          [
            "workspace",
            row.workspace,
          ],
          [
            "root_id",
            row.root_id,
          ],
          [
            "profile_id",
            row.profile_id,
          ],
        ] as const
    ) {
      const match =
        this.predicate.match(
          new RegExp(
            `${column} = '([^']*)'`,
          ),
        );

      if (
        match?.[1] !==
          undefined &&
        match[1] !== value
      ) {
        return false;
      }
    }

    return true;
  }

  private cosineDistance(
    left: readonly number[],
    right: readonly number[],
  ): number {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (
      let index = 0;
      index < left.length;
      index += 1
    ) {
      const leftValue =
        left[index] ?? 0;
      const rightValue =
        right[index] ?? 0;

      dot +=
        leftValue *
        rightValue;
      leftNorm +=
        leftValue *
        leftValue;
      rightNorm +=
        rightValue *
        rightValue;
    }

    return 1 -
      dot /
        (
          Math.sqrt(
            leftNorm,
          ) *
          Math.sqrt(
            rightNorm,
          )
        );
  }
}

class FakeMerge
  implements LanceDbMergeInsertPort
{
  constructor(
    private readonly table:
      FakeTable,
  ) {}

  public whenMatchedUpdateAll():
    this {
    return this;
  }

  public whenNotMatchedInsertAll():
    this {
    return this;
  }

  public async execute(
    data: LanceDbRow[],
  ): Promise<LanceDbMergeInsertResult> {
    this.table.mergeCalls +=
      1;

    let inserted = 0;
    let updated = 0;

    for (const row of data) {
      const index =
        this.table.rows
          .findIndex(
            (candidate) =>
              candidate
                .record_key ===
              row.record_key,
          );

      if (index >= 0) {
        this.table.rows[
          index
        ] = {
          ...row,
        };
        updated += 1;
      } else {
        this.table.rows.push({
          ...row,
        });
        inserted += 1;
      }
    }

    return {
      version:
        this.table.mergeCalls +
        1,
      numInsertedRows:
        inserted,
      numUpdatedRows:
        updated,
      numDeletedRows:
        0,
      numAttempts:
        1,
      numRows:
        data.length,
    };
  }
}

class FakeTable
  implements LanceDbTablePort
{
  public readonly rows:
    LanceDbRow[];

  public mergeCalls = 0;
  public lastSearchPredicate =
    "";

  constructor(
    rows: LanceDbRow[],
  ) {
    this.rows =
      rows.map(
        (row) => ({
          ...row,
        }),
      );
  }

  public query():
    LanceDbQueryPort {
    return new FakeQuery(
      () => this.rows,
    );
  }

  public vectorSearch(
    vector: number[],
  ): LanceDbVectorQueryPort {
    return new FakeQuery(
      () => this.rows,
      vector,
      (predicate) => {
        this.lastSearchPredicate =
          predicate;
      },
    );
  }

  public mergeInsert(
    _on:
      string |
      readonly string[],
  ): LanceDbMergeInsertPort {
    return new FakeMerge(
      this,
    );
  }
}

class FakeConnection
  implements LanceDbConnectionPort
{
  public readonly tables =
    new Map<
      string,
      FakeTable
    >();

  public createCalls = 0;

  public async tableNames():
    Promise<string[]> {
    return [
      ...this.tables.keys(),
    ];
  }

  public async openTable(
    name: string,
  ): Promise<LanceDbTablePort> {
    const table =
      this.tables.get(name);

    if (!table) {
      throw new Error(
        "Table not found.",
      );
    }

    return table;
  }

  public async createTable(
    name: string,
    data: LanceDbRow[],
  ): Promise<LanceDbTablePort> {
    if (
      this.tables.has(name)
    ) {
      throw new Error(
        "Table already exists.",
      );
    }

    this.createCalls += 1;

    const table =
      new FakeTable(data);

    this.tables.set(
      name,
      table,
    );

    return table;
  }
}

function createBatch(
  input: {
    expected: number;
    next: number;
    upserts?: readonly {
      id: string;
      path: string;
      vector: number[];
    }[];
    deletes?: readonly string[];
  },
): EmbeddingIndexWriteBatch {
  return {
    workspace:
      "workspace-a",
    rootId:
      "root-a",
    profileId:
      PROFILE.id,
    profile:
      PROFILE,
    expectedTextRevision:
      input.expected,
    nextTextRevision:
      input.next,
    upserts:
      (
        input.upserts ??
        []
      ).map(
        (
          record,
          ordinal,
        ) => ({
          chunkId:
            record.id,
          rootId:
            "root-a",
          relativePath:
            record.path,
          kind:
            "code_symbol",
          ordinal,
          contentHash:
            "aaaaaaaaaaaaaaaa",
          tokenEstimate:
            10,
          startLine:
            1,
          endLine:
            3,
          title:
            record.id,
          profileId:
            PROFILE.id,
          vector:
            record.vector,
        }),
      ),
    deleteChunkIds: [
      ...(input.deletes ??
        []),
    ],
    updatedAt:
      input.next,
  };
}

test(
  "writer creates profile table with state and vector rows",
  async () => {
    const connection =
      new FakeConnection();
    const manager =
      new LanceDbTableManager(
        connection,
      );
    const writer =
      new LanceDbVectorIndexWriter(
        manager,
      );

    const result =
      await writer.applyBatch(
        createBatch({
          expected:
            0,
          next:
            1,
          upserts: [
            {
              id:
                "chunk-a",
              path:
                "src/a.ts",
              vector:
                [1, 0],
            },
          ],
        }),
      );

    assert.equal(
      result.textRevision,
      1,
    );
    assert.equal(
      connection.createCalls,
      1,
    );

    const table =
      [...connection
        .tables
        .values()][0];

    assert.ok(table);
    assert.equal(
      table.rows.length,
      2,
    );
    assert.equal(
      table.rows.some(
        (row) =>
          "content" in row,
      ),
      false,
    );

    const state =
      await writer.getState({
        workspace:
          "workspace-a",
        rootId:
          "root-a",
        profileId:
          PROFILE.id,
      });

    assert.equal(
      state?.textRevision,
      1,
    );
  },
);

test(
  "writer applies mixed changes in one merge and tombstones deletions",
  async () => {
    const connection =
      new FakeConnection();
    const manager =
      new LanceDbTableManager(
        connection,
      );
    const writer =
      new LanceDbVectorIndexWriter(
        manager,
      );

    await writer.applyBatch(
      createBatch({
        expected:
          0,
        next:
          1,
        upserts: [
          {
            id:
              "chunk-a",
            path:
              "src/a.ts",
            vector:
              [1, 0],
          },
        ],
      }),
    );

    await writer.applyBatch(
      createBatch({
        expected:
          1,
        next:
          2,
        upserts: [
          {
            id:
              "chunk-b",
            path:
              "src/b.ts",
            vector:
              [0, 1],
          },
        ],
        deletes: [
          "chunk-a",
        ],
      }),
    );

    const table =
      [...connection
        .tables
        .values()][0];

    assert.ok(table);
    assert.equal(
      table.mergeCalls,
      1,
    );

    const deleted =
      table.rows.find(
        (row) =>
          row.chunk_id ===
          "chunk-a",
      );

    assert.equal(
      deleted?.active,
      false,
    );

    const state =
      await writer.getState({
        workspace:
          "workspace-a",
        rootId:
          "root-a",
        profileId:
          PROFILE.id,
      });

    assert.equal(
      state?.textRevision,
      2,
    );
  },
);

test(
  "writer rejects a stale expected revision",
  async () => {
    const connection =
      new FakeConnection();
    const writer =
      new LanceDbVectorIndexWriter(
        new LanceDbTableManager(
          connection,
        ),
      );

    await writer.applyBatch(
      createBatch({
        expected:
          0,
        next:
          1,
      }),
    );

    await assert.rejects(
      writer.applyBatch(
        createBatch({
          expected:
            0,
          next:
            2,
        }),
      ),
      VectorIndexRevisionMismatchError,
    );
  },
);

test(
  "reader returns ranked active matches without source content",
  async () => {
    const connection =
      new FakeConnection();
    const manager =
      new LanceDbTableManager(
        connection,
      );
    const writer =
      new LanceDbVectorIndexWriter(
        manager,
      );

    await writer.applyBatch(
      createBatch({
        expected:
          0,
        next:
          1,
        upserts: [
          {
            id:
              "chunk-a",
            path:
              "src/a.ts",
            vector:
              [1, 0],
          },
          {
            id:
              "chunk-b",
            path:
              "src/b.ts",
            vector:
              [0, 1],
          },
        ],
      }),
    );

    const service =
      new VectorSearchService(
        new LanceDbVectorIndexReader(
          manager,
        ),
      );

    const result =
      await service.search({
        workspace:
          "workspace-a",
        profile:
          PROFILE,
        queryVector:
          [1, 0],
        rootIds: [
          "root-a",
        ],
        folderPrefix:
          "src",
        maximumResults:
          1,
      });

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.matches[0]
        ?.chunkId,
      "chunk-a",
    );
    assert.equal(
      result.matches[0]
        ?.score,
      1,
    );
    assert.equal(
      "content" in
        (
          result.matches[0] ??
          {}
        ),
      false,
    );

    const table =
      [...connection
        .tables
        .values()][0];

    assert.match(
      table
        ?.lastSearchPredicate ??
        "",
      /active = true/,
    );
  },
);

test(
  "normalizer rejects dimension and normalization mismatches",
  () => {
    const normalizer =
      new VectorSearchRequestNormalizer();

    assert.throws(
      () =>
        normalizer.normalize({
          workspace:
            "workspace-a",
          profile:
            PROFILE,
          queryVector:
            [1],
        }),
    );

    assert.throws(
      () =>
        normalizer.normalize({
          workspace:
            "workspace-a",
          profile:
            PROFILE,
          queryVector:
            [1, 1],
        }),
    );
  },
);

test(
  "table names are stable and profile-specific",
  () => {
    const builder =
      new VectorIndexTableNameBuilder();

    const first =
      builder.build(
        "v8_vectors",
        PROFILE.id,
      );

    assert.equal(
      first,
      builder.build(
        "v8_vectors",
        PROFILE.id,
      ),
    );

    assert.notEqual(
      first,
      builder.build(
        "v8_vectors",
        "another-profile",
      ),
    );
  },
);
