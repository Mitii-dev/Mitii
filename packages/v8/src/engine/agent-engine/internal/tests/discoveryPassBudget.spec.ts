import { describe, expect, it } from "vitest";

import {
  DISCOVERY_PASS_POLICY,
  createDiscoveryObservationCollector,
  discoveryBudgetRemaining,
  discoveryCanModelTurn,
  discoveryCanReadMore,
  extractDiscoveryReadText,
  formatDiscoveryPreReadEvidence,
} from "../discoveryPass";

describe("discovery pass budget after shaped preflight", () => {
  it("leaves headroom beyond a full shaped preflight (3 globs + 1 search)", () => {
    expect(DISCOVERY_PASS_POLICY.maxSearches).toBeGreaterThan(4);
  });

  it("still allows seed reads when search budget is spent", () => {
    const collector = createDiscoveryObservationCollector();
    collector.searches = DISCOVERY_PASS_POLICY.maxSearches;
    collector.toolCalls = 4;
    expect(discoveryBudgetRemaining(collector)).toBe(false);
    expect(discoveryCanReadMore(collector)).toBe(true);
    expect(discoveryCanModelTurn(collector)).toBe(true);
  });

  it("blocks model turns when tool and file budgets are exhausted", () => {
    const collector = createDiscoveryObservationCollector();
    collector.toolCalls = DISCOVERY_PASS_POLICY.maxToolCalls;
    collector.fileReads = DISCOVERY_PASS_POLICY.maxFileReads;
    collector.searches = DISCOVERY_PASS_POLICY.maxSearches;
    expect(discoveryCanReadMore(collector)).toBe(false);
    expect(discoveryCanModelTurn(collector)).toBe(false);
  });
});

describe("formatDiscoveryPreReadEvidence", () => {
  it("embeds file bodies for the discovery model", () => {
    const text = formatDiscoveryPreReadEvidence([
      { path: "wdio.desktop.conf.ts", content: "export const config = {};" },
      {
        path: "test/shared/config/testConfig.ts",
        content: "export const headless = false;",
      },
    ]);
    expect(text).toContain("<pre_read_evidence");
    expect(text).toContain("### wdio.desktop.conf.ts");
    expect(text).toContain("export const config = {};");
    expect(text).toContain("### test/shared/config/testConfig.ts");
  });

  it("truncates oversized bodies", () => {
    const text = formatDiscoveryPreReadEvidence(
      [{ path: "big.ts", content: "x".repeat(500) }],
      { maxCharsPerFile: 40, maxTotalChars: 200 },
    );
    expect(text).toContain("…(truncated)");
    expect(text.length).toBeLessThan(200);
  });
});

describe("extractDiscoveryReadText", () => {
  it("prefers content/text fields from tool output", () => {
    expect(extractDiscoveryReadText({ content: "hello" })).toBe("hello");
    expect(extractDiscoveryReadText({ text: "world" })).toBe("world");
    expect(extractDiscoveryReadText("raw")).toBe("raw");
  });
});
