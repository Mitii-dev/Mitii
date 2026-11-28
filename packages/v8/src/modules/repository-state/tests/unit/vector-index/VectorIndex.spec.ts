import assert from "node:assert/strict";
import test from "node:test";

import {
  LanceDbTableManager,
  LanceDbVectorIndexWriter,
  VectorIndexRevisionMismatchError,
} from "../../../helpers/vector-index/index";

import {
  FakeConnection,
  PROFILE,
  createBatch,
} from "./fixtures/vectorIndexFixtures";

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
