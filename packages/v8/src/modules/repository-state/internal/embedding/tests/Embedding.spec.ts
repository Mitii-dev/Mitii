import assert from "node:assert/strict";
import test from "node:test";

import {
  EmbeddingError,
  EmbeddingGenerator,
} from "../index";

import {
  DeterministicProvider,
  InvalidDimensionProvider,
  createChunk,
} from "./fixtures/embeddingFixtures";

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
