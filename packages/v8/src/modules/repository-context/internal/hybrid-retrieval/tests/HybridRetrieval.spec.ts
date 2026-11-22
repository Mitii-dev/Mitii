import assert from "node:assert/strict";
import test from "node:test";
import { HybridRetriever } from "../HybridRetriever";
import type { RetrievalReranker } from "../types";
import {
  StaticRetrievalSource,
  FailingRetrievalSource,
  candidate,
  complete,
  baseInput,
} from "./hybridRetrievalHarness";

test(
  "weighted RRF rewards candidates found by multiple sources",
  async () => {
    const shared =
      candidate(
        "src/auth.ts",
        "auth",
        0.8,
      );

    const retriever =
      new HybridRetriever([
        {
          source:
            new StaticRetrievalSource(
              "lexical",
              complete([
                shared,
                candidate(
                  "src/only-text.ts",
                  "text",
                  1,
                ),
              ]),
            ),
        },
        {
          source:
            new StaticRetrievalSource(
              "semantic",
              complete([
                {
                  ...shared,
                  sourceScore:
                    0.7,
                  reasons: [
                    {
                      type:
                        "semantic_match",
                      evidence:
                        "Semantic match.",
                    },
                  ],
                },
              ]),
            ),
        },
      ]);

    const result =
      await retriever.retrieve(
        baseInput,
      );

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.candidates[0]
        ?.relativePath,
      "src/auth.ts",
    );
    assert.equal(
      result.candidates[0]
        ?.matchedSourceCount,
      2,
    );
    assert.equal(
      result.candidates[0]
        ?.contributions.length,
      2,
    );
    assert.equal(
      result.statistics
        .duplicateCandidatesRemoved,
      1,
    );
  },
);

test(
  "best-effort retrieval returns partial output when one source fails",
  async () => {
    const retriever =
      new HybridRetriever([
        {
          source:
            new StaticRetrievalSource(
              "working",
              complete([
                candidate(
                  "src/a.ts",
                  "a",
                  1,
                ),
              ]),
            ),
        },
        {
          source:
            new FailingRetrievalSource(
              "broken",
            ),
        },
      ]);

    const result =
      await retriever.retrieve(
        baseInput,
      );

    assert.equal(
      result.status,
      "partial",
    );
    assert.equal(
      result.candidates.length,
      1,
    );
    assert.equal(
      result.statistics
        .failedSources,
      1,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "source_failed",
      ),
    );
  },
);

test(
  "required-source policy produces an explicit failed result",
  async () => {
    const retriever =
      new HybridRetriever(
        [
          {
            source:
              new StaticRetrievalSource(
                "working",
                complete([
                  candidate(
                    "src/a.ts",
                    "a",
                    1,
                  ),
                ]),
              ),
          },
          {
            source:
              new FailingRetrievalSource(
                "required",
              ),
            required:
              true,
          },
        ],
        {
          failureMode:
            "required_sources",
        },
      );

    const result =
      await retriever.retrieve(
        baseInput,
      );

    assert.equal(
      result.status,
      "failed",
    );
    assert.equal(
      result.candidates.length,
      0,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "failure_policy_unsatisfied",
      ),
    );
  },
);

test(
  "minimum successful source policy is distinguishable from failure mode",
  async () => {
    const retriever =
      new HybridRetriever(
        [
          {
            source:
              new StaticRetrievalSource(
                "working",
                complete([]),
              ),
          },
          {
            source:
              new FailingRetrievalSource(
                "broken",
                "capability",
              ),
          },
        ],
        {
          minimumSuccessfulSources:
            2,
        },
      );

    const result =
      await retriever.retrieve(
        baseInput,
      );

    assert.equal(
      result.status,
      "failed",
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "minimum_sources_unsatisfied",
      ),
    );
  },
);

test(
  "pre-aborted requests return deterministic cancellation output",
  async () => {
    const controller =
      new AbortController();
    controller.abort();

    const retriever =
      new HybridRetriever([
        {
          source:
            new StaticRetrievalSource(
              "source",
              complete([]),
            ),
        },
      ]);

    const result =
      await retriever.retrieve({
        ...baseInput,
        abortSignal:
          controller.signal,
      });

    assert.equal(
      result.status,
      "cancelled",
    );
    assert.equal(
      result.statistics
        .attemptedSources,
      1,
    );
    assert.equal(
      result.statistics
        .failedSources,
      1,
    );
  },
);

test(
  "reranker failure behavior is explicit and configurable",
  async () => {
    const reranker:
      RetrievalReranker = {
        id:
          "failing-reranker",
        async rerank() {
          throw new Error(
            "Reranker failed.",
          );
        },
      };

    const registrations = [
      {
        source:
          new StaticRetrievalSource(
            "source",
            complete([
              candidate(
                "src/a.ts",
                "a",
                1,
              ),
            ]),
          ),
      },
    ];

    const fallback =
      await new HybridRetriever(
        registrations,
        {
          rerankerFailureMode:
            "fallback_to_fusion",
        },
        reranker,
      ).retrieve(baseInput);

    const required =
      await new HybridRetriever(
        registrations,
        {
          rerankerFailureMode:
            "fail",
        },
        reranker,
      ).retrieve(baseInput);

    assert.equal(
      fallback.status,
      "partial",
    );
    assert.equal(
      fallback.candidates.length,
      1,
    );
    assert.equal(
      required.status,
      "failed",
    );
    assert.ok(
      required.warnings.some(
        (warning) =>
          warning.code ===
          "reranker_failed",
      ),
    );
  },
);
