import assert from "node:assert/strict";
import test from "node:test";

import { ContextSelector } from "../../../helpers/context-selection/ContextSelector";
import { chunk, retrieval } from "./fixtures/contextSelectionFixtures";

test(
  "explicit files are synthesized and selected before retrieved context",
  () => {
    const selector =
      new ContextSelector();
    const result =
      selector.select({
        query:
          "Fix src/auth.ts",
        retrieval:
          retrieval([
            chunk(
              "src/unrelated.ts",
              "unrelated",
              0.95,
            ),
          ]),
        references: {
          explicitFiles: [
            {
              rootId:
                "root",
              relativePath:
                "src/auth.ts",
            },
          ],
        },
      });

    assert.equal(
      result.items[0]
        ?.relativePath,
      "src/auth.ts",
    );
    assert.equal(
      result.items[0]
        ?.priority,
      "required",
    );
    assert.equal(
      result.items[0]
        ?.representation,
      "full_file",
    );
  },
);

test(
  "selection is mode-aware when choosing file representations",
  () => {
    const selector =
      new ContextSelector();
    const input = {
      query:
        "Review the current file",
      retrieval:
        retrieval([]),
      references: {
        currentFile: {
          rootId:
            "root",
          relativePath:
            "src/current.ts",
        },
      },
    } as const;

    const ask =
      selector.select({
        ...input,
        mode:
          "ask",
      });
    const plan =
      selector.select({
        ...input,
        mode:
          "plan",
      });

    assert.equal(
      ask.items[0]
        ?.representation,
      "full_file",
    );
    assert.equal(
      plan.items[0]
        ?.representation,
      "file_outline",
    );
  },
);

test(
  "broad planning selection favors file diversity over redundant chunks",
  () => {
    const selector =
      new ContextSelector();
    const result =
      selector.select({
        query:
          "Plan authentication changes",
        mode:
          "plan",
        breadth:
          "broad",
        retrieval:
          retrieval([
            chunk(
              "src/auth.ts",
              "auth-1",
              0.9,
              1,
            ),
            chunk(
              "src/auth.ts",
              "auth-2",
              0.89,
              40,
            ),
            chunk(
              "src/database.ts",
              "database",
              0.82,
              1,
            ),
          ]),
        budget: {
          maximumTokens:
            1_200,
          maximumItems:
            2,
          maximumFiles:
            2,
          maximumItemsPerFile:
            2,
        },
      });

    assert.deepEqual(
      result.items.map(
        (item) =>
          item.relativePath,
      ),
      [
        "src/auth.ts",
        "src/database.ts",
      ],
    );
  },
);

test(
  "representation is downgraded instead of violating the token budget",
  () => {
    const selector =
      new ContextSelector();
    const result =
      selector.select({
        query:
          "Explain src/auth.ts",
        retrieval:
          retrieval([]),
        references: {
          explicitFiles: [
            {
              relativePath:
                "src/auth.ts",
            },
          ],
        },
        budget: {
          maximumTokens:
            320,
        },
      });

    assert.equal(
      result.items[0]
        ?.representation,
      "file_outline",
    );
    assert.equal(
      result.budget
        .usedTokens,
      320,
    );
    assert.equal(
      result.status,
      "partial",
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "representation_downgraded",
      ),
    );
  },
);

test(
  "required-reference overflow is visible and can fail closed",
  () => {
    const input = {
      query:
        "Use src/auth.ts",
      retrieval:
        retrieval([]),
      references: {
        explicitFiles: [
          {
            relativePath:
              "src/auth.ts",
          },
        ],
      },
      budget: {
        maximumTokens:
          100,
      },
    } as const;

    const partial =
      new ContextSelector()
        .select(input);
    const failed =
      new ContextSelector({
        requiredOverflowMode:
          "fail",
      }).select(input);

    assert.equal(
      partial.status,
      "partial",
    );
    assert.equal(
      partial.items.length,
      0,
    );
    assert.equal(
      partial.dropped[0]
        ?.cause,
      "required_reference_omitted",
    );
    assert.equal(
      failed.status,
      "failed",
    );
    assert.equal(
      failed.items.length,
      0,
    );
  },
);
