import assert from "node:assert/strict";
import test from "node:test";

import {
  EmbeddingFactory,
} from "../index";

import {
  DeterministicProvider,
  MemoryTextIndex,
  MemoryVectorWriter,
  change,
  createChunk,
} from "./fixtures/embeddingFixtures";

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
