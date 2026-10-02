import { describe, expect, it } from "vitest";

import { applyModalityQuotas } from "../internal/hybrid-retrieval/applyModalityQuotas";
import { HybridRetriever } from "../internal/hybrid-retrieval/HybridRetriever";
import { RetrievalCandidateKeyBuilder } from "../internal/hybrid-retrieval/RetrievalCandidateKeyBuilder";
import { WeightedReciprocalRankFusion } from "../internal/hybrid-retrieval/WeightedReciprocalRankFusion";
import { HYBRID_RETRIEVAL_IDS } from "../internal/hybrid-retrieval/constants";
import {
  SessionContextRetrievalSource,
} from "../internal/hybrid-retrieval/sources/SessionContextRetrievalSource";
import type {
  HybridRetrievalCandidate,
  RetrievalCandidate,
  RetrievalSource,
  RetrievalSourceResult,
  SuccessfulRetrievalSourceResult,
} from "../internal/hybrid-retrieval/types";

class StaticRetrievalSource implements RetrievalSource {
  constructor(
    public readonly id: string,
    private readonly result: RetrievalSourceResult | (() => Promise<RetrievalSourceResult>),
  ) {}

  public canRetrieve(): boolean {
    return true;
  }

  public async retrieve(): Promise<RetrievalSourceResult> {
    return typeof this.result === "function"
      ? this.result()
      : this.result;
  }
}

function candidate(
  relativePath: string,
  sourceScore: number,
  extras: Partial<RetrievalCandidate> = {},
): RetrievalCandidate {
  return {
    entityKind: extras.entityKind ?? "chunk",
    rootId: "root",
    relativePath,
    chunkId: extras.chunkId ?? relativePath,
    sourceScore,
    reasons: [
      {
        type: "lexical_match",
        evidence: `Matched ${relativePath}.`,
      },
    ],
    ...extras,
  };
}

function fused(
  relativePath: string,
  sourceId: string,
  score: number,
): HybridRetrievalCandidate {
  return {
    key: `file|4:root|${relativePath.length}:${relativePath}`,
    entityKind: "file",
    rootId: "root",
    relativePath,
    fusedScore: score,
    score,
    matchedSourceCount: 1,
    contributions: [
      {
        sourceId,
        sourceRank: 1,
        sourceScore: score,
        sourceWeight: 1,
        reciprocalRankScore: score,
        reasons: [],
      },
    ],
    reasons: [],
  };
}

describe("repository-context P1 injection", () => {
  it("soft-timeouts slow optional sources without failing retrieval", async () => {
    const result = await new HybridRetriever(
      [
        {
          source: new StaticRetrievalSource("fast", {
            status: "complete",
            candidates: [candidate("src/fast.ts", 0.9)],
            truncated: false,
            warnings: [],
          }),
        },
        {
          source: new StaticRetrievalSource("slow", async () => {
            await new Promise((resolve) => setTimeout(resolve, 80));
            return {
              status: "complete",
              candidates: [candidate("src/slow.ts", 1)],
              truncated: false,
              warnings: [],
            };
          }),
          timeoutMs: 15,
        },
      ],
      { sourceTimeoutMs: 15 },
    ).retrieve({
      workspace: "workspace",
      query: "find handler",
    });

    expect(
      result.candidates.some(
        (entry) => entry.relativePath === "src/fast.ts",
      ),
    ).toBe(true);
    expect(
      result.candidates.some(
        (entry) => entry.relativePath === "src/slow.ts",
      ),
    ).toBe(false);
    expect(
      result.warnings.some((warning) => warning.code === "source_timeout"),
    ).toBe(true);
    expect(
      result.sourceReports.find((report) => report.sourceId === "slow")
        ?.status,
    ).toBe("skipped");
  });

  it("session context source surfaces open and current files", async () => {
    const result = await new HybridRetriever([
      { source: new SessionContextRetrievalSource() },
    ]).retrieve({
      workspace: "workspace",
      query: "inspect open work",
      rankingContext: {
        currentFile: "src/app/Main.ts",
        openFiles: ["src/app/Main.ts", "src/app/Other.ts"],
        recentEditFiles: ["src/app/Recent.ts"],
      },
    });

    const paths = result.candidates.map((entry) => entry.relativePath);
    expect(paths).toContain("src/app/Main.ts");
    expect(paths).toContain("src/app/Other.ts");
    expect(paths).toContain("src/app/Recent.ts");
    expect(
      result.candidates[0]?.reasons.some(
        (reason) => reason.type === "session_current_file",
      ),
    ).toBe(true);
  });

  it("applies modality quotas when vector retrieval is degraded", () => {
    const successful: SuccessfulRetrievalSourceResult[] = [
      {
        sourceId: HYBRID_RETRIEVAL_IDS.TEXT_SOURCE,
        sourceWeight: 1,
        candidates: [candidate("src/a.ts", 1)],
        truncated: false,
      },
      {
        sourceId: HYBRID_RETRIEVAL_IDS.REPO_GRAPH_SOURCE,
        sourceWeight: 1,
        candidates: [candidate("src/b.ts", 1)],
        truncated: false,
      },
      {
        sourceId: HYBRID_RETRIEVAL_IDS.REPO_MAP_SOURCE,
        sourceWeight: 1,
        candidates: [candidate("src/c.ts", 1)],
        truncated: false,
      },
    ];

    const candidates = [
      fused("src/noise1.ts", HYBRID_RETRIEVAL_IDS.TEXT_SOURCE, 1),
      fused("src/noise2.ts", HYBRID_RETRIEVAL_IDS.TEXT_SOURCE, 0.99),
      fused("src/noise3.ts", HYBRID_RETRIEVAL_IDS.TEXT_SOURCE, 0.98),
      fused("src/noise4.ts", HYBRID_RETRIEVAL_IDS.TEXT_SOURCE, 0.97),
      fused("src/b.ts", HYBRID_RETRIEVAL_IDS.REPO_GRAPH_SOURCE, 0.2),
      fused("src/c.ts", HYBRID_RETRIEVAL_IDS.REPO_MAP_SOURCE, 0.1),
    ];

    const quota = applyModalityQuotas({
      candidates,
      successful,
      maximumResults: 4,
    });

    expect(quota.warning?.code).toBe("modality_quota_applied");
    const paths = quota.candidates.map((entry) => entry.relativePath);
    expect(paths).toContain("src/b.ts");
    expect(paths).toContain("src/c.ts");
  });

  it("span-aware keys fuse identical line ranges across sources", () => {
    const fusion = new WeightedReciprocalRankFusion(
      new RetrievalCandidateKeyBuilder(),
    );

    const left = candidate("src/LoginForm.tsx", 0.9, {
      entityKind: "file",
      chunkId: undefined,
      startLine: 10,
      endLine: 20,
    });
    const right = candidate("src/LoginForm.tsx", 0.8, {
      entityKind: "file",
      chunkId: undefined,
      startLine: 10,
      endLine: 20,
      reasons: [
        {
          type: "semantic_match",
          evidence: "Vector hit on the same span.",
        },
      ],
    });

    const fusedResult = fusion.fuse({
      sourceResults: [
        {
          sourceId: "lexical",
          sourceWeight: 1,
          candidates: [left],
          truncated: false,
        },
        {
          sourceId: "vector",
          sourceWeight: 1,
          candidates: [right],
          truncated: false,
        },
      ],
      rankConstant: 60,
      maximumResults: 5,
    });

    expect(fusedResult.candidates).toHaveLength(1);
    expect(fusedResult.candidates[0]?.matchedSourceCount).toBe(2);
    expect(fusedResult.candidates[0]?.startLine).toBe(10);
    expect(fusedResult.candidates[0]?.endLine).toBe(20);
  });
});
