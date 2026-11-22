import assert from "node:assert/strict";
import test from "node:test";

import { ContextSelector } from "../ContextSelector";
import { chunk, retrieval } from "./fixtures/contextSelectionFixtures";

test(
  "per-file limits remain hard and explain every omission",
  () => {
    const selector =
      new ContextSelector();
    const result =
      selector.select({
        query:
          "Inspect auth functions",
        retrieval:
          retrieval([
            chunk(
              "src/auth.ts",
              "one",
              0.9,
              1,
            ),
            chunk(
              "src/auth.ts",
              "two",
              0.8,
              40,
            ),
          ]),
        budget: {
          maximumItems:
            2,
          maximumItemsPerFile:
            1,
        },
      });

    assert.equal(
      result.items.length,
      1,
    );
    assert.equal(
      result.dropped[0]
        ?.cause,
      "per_file_limit",
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "per_file_limit_reached",
      ),
    );
  },
);

test(
  "internal and generated paths are excluded even when explicitly requested",
  () => {
    const selector =
      new ContextSelector();
    const result =
      selector.select({
        query:
          "Read node_modules/pkg/index.js",
        retrieval:
          retrieval([]),
        references: {
          explicitFiles: [
            {
              relativePath:
                "node_modules/pkg/index.js",
            },
          ],
        },
      });

    assert.equal(
      result.status,
      "partial",
    );
    assert.equal(
      result.items.length,
      0,
    );
    assert.equal(
      result.dropped[0]
        ?.cause,
      "excluded_path",
    );
  },
);

test(
  "package manager artifacts and runtime logs are excluded from retrieved context",
  () => {
    const selector =
      new ContextSelector();
    const result =
      selector.select({
        query:
          "Research receipt designer",
        retrieval:
          retrieval([
            chunk(
              ".pnp.cjs",
              "pnp",
              0.99,
            ),
            chunk(
              "logs/pm2-out-0.log",
              "runtime-log",
              0.98,
            ),
            chunk(
              "app/admin/model/client-modal.ts",
              "client",
              0.8,
            ),
          ]),
      });

    assert.deepEqual(
      result.items.map(
        (item) =>
          item.relativePath,
      ),
      [
        "app/admin/model/client-modal.ts",
      ],
    );
    assert.equal(
      result.dropped.length,
      2,
    );
    assert.ok(
      result.dropped.every(
        (item) =>
          item.cause ===
          "excluded_path",
      ),
    );
  },
);

test(
  "explicit context can survive a failed retrieval as a partial selection",
  () => {
    const selector =
      new ContextSelector();
    const result =
      selector.select({
        query:
          "Fix src/auth.ts",
        retrieval:
          retrieval(
            [],
            "failed",
          ),
        references: {
          explicitFiles: [
            {
              relativePath:
                "src/auth.ts",
            },
          ],
        },
      });

    assert.equal(
      result.status,
      "partial",
    );
    assert.equal(
      result.items.length,
      1,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "upstream_retrieval_failed",
      ),
    );
  },
);

test(
  "pre-aborted selection is deterministic and contains no selected items",
  () => {
    const controller =
      new AbortController();
    controller.abort();

    const selector =
      new ContextSelector();
    const input = {
      query:
        "Inspect auth",
      retrieval:
        retrieval([
          chunk(
            "src/auth.ts",
            "auth",
            1,
          ),
        ]),
      abortSignal:
        controller.signal,
    };

    const first =
      selector.select(input);
    const second =
      selector.select(input);

    assert.equal(
      first.status,
      "cancelled",
    );
    assert.equal(
      first.items.length,
      0,
    );
    assert.deepEqual(
      first,
      second,
    );
  },
);
