import assert from "node:assert/strict";
import test from "node:test";

import {
  LanceDbTableManager,
  LanceDbVectorIndexReader,
  LanceDbVectorIndexWriter,
  VectorIndexTableNameBuilder,
  VectorSearchRequestNormalizer,
  VectorSearchService,
} from "../index";

import {
  FakeConnection,
  PROFILE,
  createBatch,
} from "./fixtures/vectorIndexFixtures";

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
        filePaths: [
          "tsconfig.json",
        ],
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
    assert.match(
      table
        ?.lastSearchPredicate ??
        "",
      /relative_path IN \('tsconfig\.json'\) OR relative_path = 'src' OR starts_with\(relative_path, 'src\/'\)/,
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
