import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextSelector,
} from "../ContextSelector";

import type {
  HybridRetrievalCandidate,
  HybridRetrievalResult,
  HybridRetrievalStatus,
} from "../../hybrid-retrieval/types";

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

function chunk(
  relativePath: string,
  chunkId: string,
  score: number,
  startLine = 1,
): HybridRetrievalCandidate {
  const reason = {
    type:
      "lexical_match" as const,
    evidence:
      `Matched ${relativePath}.`,
  };

  return {
    key:
      `chunk:${chunkId}`,
    entityKind:
      "chunk",
    rootId:
      "root",
    relativePath,
    chunkId,
    startLine,
    endLine:
      startLine + 10,
    tokenEstimate:
      200,
    fusedScore:
      score,
    score,
    matchedSourceCount:
      1,
    contributions: [
      {
        sourceId:
          "text-index",
        sourceRank:
          1,
        sourceScore:
          score,
        sourceWeight:
          1,
        reciprocalRankScore:
          0.01,
        reasons: [
          reason,
        ],
      },
    ],
    reasons: [
      reason,
    ],
  };
}

function retrieval(
  candidates:
    HybridRetrievalCandidate[],
  status:
    HybridRetrievalStatus =
    "complete",
): HybridRetrievalResult {
  const isFailure =
    status ===
      "failed" ||
    status ===
      "empty" ||
    status ===
      "cancelled";
  const returned =
    isFailure
      ? []
      : candidates;

  return {
    schemaVersion:
      1,
    query:
      "query",
    status,
    candidates:
      returned,
    sourceReports: [
      {
        sourceId:
          "text-index",
        status:
          status ===
          "failed"
            ? "failed"
            : status ===
                "cancelled"
              ? "cancelled"
              : returned
                    .length >
                  0
                ? "complete"
                : "empty",
        required:
          false,
        weight:
          1,
        candidateCount:
          returned.length,
        truncated:
          false,
        warningCount:
          0,
      },
    ],
    warnings:
      status ===
      "partial"
        ? [
            {
              code:
                "source_failed",
              message:
                "A source failed.",
            },
          ]
        : [],
    truncated:
      false,
    statistics: {
      configuredSources:
        1,
      attemptedSources:
        1,
      successfulSources:
        status ===
          "failed" ||
        status ===
          "cancelled"
          ? 0
          : 1,
      failedSources:
        status ===
          "failed" ||
        status ===
          "cancelled"
          ? 1
          : 0,
      skippedSources:
        0,
      sourceCandidates:
        returned.length,
      uniqueCandidates:
        returned.length,
      duplicateCandidatesRemoved:
        0,
      returnedCandidates:
        returned.length,
    },
  };
}
