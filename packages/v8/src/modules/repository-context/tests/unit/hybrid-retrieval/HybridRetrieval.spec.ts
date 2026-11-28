import { describe, expect, it } from "vitest";
import { HybridRetriever } from "../../../helpers/hybrid-retrieval/HybridRetriever";
import { HYBRID_RETRIEVAL_IDS } from "../../../helpers/hybrid-retrieval/constants";
import type { RetrievalReranker } from "../../../helpers/hybrid-retrieval/types";
import {
  StaticRetrievalSource,
  FailingRetrievalSource,
  candidate,
  complete,
  baseInput,
} from "./hybridRetrievalHarness";

describe("HybridRetriever fusion and failure policy", () => {
  it("weighted RRF rewards candidates found by multiple sources", async () => {
    // The semantic source uses the real vector source id. With a non-vector id
    // the retriever intentionally rebalances modality quotas and reports
    // "partial" (see applyModalityQuotas), which is a different contract.
    const shared = candidate("src/auth.ts", "auth", 0.8);

    const retriever = new HybridRetriever([
      {
        source: new StaticRetrievalSource(
          "lexical",
          complete([shared, candidate("src/only-text.ts", "text", 1)]),
        ),
      },
      {
        source: new StaticRetrievalSource(
          HYBRID_RETRIEVAL_IDS.VECTOR_SOURCE,
          complete([
            {
              ...shared,
              sourceScore: 0.7,
              reasons: [
                { type: "semantic_match", evidence: "Semantic match." },
              ],
            },
          ]),
        ),
      },
    ]);

    const result = await retriever.retrieve(baseInput);

    expect(result.status).toBe("complete");
    expect(result.candidates[0]?.relativePath).toBe("src/auth.ts");
    expect(result.candidates[0]?.matchedSourceCount).toBe(2);
    expect(result.candidates[0]?.contributions.length).toBe(2);
    expect(result.statistics.duplicateCandidatesRemoved).toBe(1);
  });

  it("reports partial when vector retrieval is absent and modality quotas rebalance", async () => {
    const result = await new HybridRetriever([
      {
        source: new StaticRetrievalSource(
          "lexical",
          complete([candidate("src/a.ts", "a", 1)]),
        ),
      },
    ]).retrieve(baseInput);

    expect(result.status).toBe("partial");
    expect(
      result.warnings.some((w) => w.code === "modality_quota_applied"),
    ).toBe(true);
  });

  it("best-effort retrieval returns partial output when one source fails", async () => {
    const retriever = new HybridRetriever([
      {
        source: new StaticRetrievalSource(
          "working",
          complete([candidate("src/a.ts", "a", 1)]),
        ),
      },
      { source: new FailingRetrievalSource("broken") },
    ]);

    const result = await retriever.retrieve(baseInput);

    // A failed optional source degrades the run to "partial"; "complete" is
    // reserved for runs where every attempted source succeeded.
    expect(result.status).toBe("partial");
    expect(result.candidates.length).toBe(1);
    expect(result.statistics.failedSources).toBe(1);
    expect(
      result.warnings.some((warning) => warning.code === "source_failed"),
    ).toBe(true);
  });

  it("required-source policy produces an explicit failed result", async () => {
    const retriever = new HybridRetriever(
      [
        {
          source: new StaticRetrievalSource(
            "working",
            complete([candidate("src/a.ts", "a", 1)]),
          ),
        },
        {
          source: new FailingRetrievalSource("required"),
          required: true,
        },
      ],
      { failureMode: "required_sources" },
    );

    const result = await retriever.retrieve(baseInput);

    expect(result.status).toBe("failed");
    expect(result.candidates.length).toBe(0);
    expect(
      result.warnings.some(
        (warning) => warning.code === "failure_policy_unsatisfied",
      ),
    ).toBe(true);
  });

  it("minimum successful source policy is distinguishable from failure mode", async () => {
    const retriever = new HybridRetriever(
      [
        { source: new StaticRetrievalSource("working", complete([])) },
        { source: new FailingRetrievalSource("broken", "capability") },
      ],
      { minimumSuccessfulSources: 2 },
    );

    const result = await retriever.retrieve(baseInput);

    expect(result.status).toBe("failed");
    expect(
      result.warnings.some(
        (warning) => warning.code === "minimum_sources_unsatisfied",
      ),
    ).toBe(true);
  });

  it("pre-aborted requests return deterministic cancellation output", async () => {
    const controller = new AbortController();
    controller.abort();

    const retriever = new HybridRetriever([
      { source: new StaticRetrievalSource("source", complete([])) },
    ]);

    const result = await retriever.retrieve({
      ...baseInput,
      abortSignal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
    expect(result.statistics.attemptedSources).toBe(1);
    expect(result.statistics.failedSources).toBe(1);
  });

  it("reranker failure behavior is explicit and configurable", async () => {
    const reranker: RetrievalReranker = {
      id: "failing-reranker",
      async rerank() {
        throw new Error("Reranker failed.");
      },
    };

    const registrations = [
      {
        source: new StaticRetrievalSource(
          "source",
          complete([candidate("src/a.ts", "a", 1)]),
        ),
      },
    ];

    const fallback = await new HybridRetriever(
      registrations,
      { rerankerFailureMode: "fallback_to_fusion" },
      reranker,
    ).retrieve(baseInput);

    const required = await new HybridRetriever(
      registrations,
      { rerankerFailureMode: "fail" },
      reranker,
    ).retrieve(baseInput);

    // Falling back to fusion order still returns candidates but is not a
    // fully healthy run, so it is "partial" rather than "complete".
    expect(fallback.status).toBe("partial");
    expect(fallback.candidates.length).toBe(1);
    expect(required.status).toBe("failed");
    expect(
      required.warnings.some((warning) => warning.code === "reranker_failed"),
    ).toBe(true);
  });
});
