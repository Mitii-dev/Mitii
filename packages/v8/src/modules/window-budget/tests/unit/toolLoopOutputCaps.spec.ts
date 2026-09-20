import { describe, expect, it } from "vitest";

import { resolveWindowBudgetPolicy } from "../../policy";
import {
  COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP,
  resolveToolLoopMaxOutputTokens,
} from "../../toolLoopOutputCaps";
import { WINDOW_BUDGET_BAND_CEILINGS } from "../../windowBudgetBands";

describe("toolLoopOutputCaps", () => {
  it("scales with context window × outputWindowCapRatio (compact hard-capped)", () => {
    for (const window of [30_000, 45_000, 65_000, 100_000, 200_000, 256_000]) {
      const { policy } = resolveWindowBudgetPolicy({
        contextWindowTokens: window,
      });
      const scaled = Math.floor(window * policy.outputWindowCapRatio);
      const expected =
        window < WINDOW_BUDGET_BAND_CEILINGS.compactMaxExclusive
          ? Math.min(scaled, COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP)
          : scaled;
      expect(resolveToolLoopMaxOutputTokens(window)).toBe(expected);
    }
  });

  it("keeps compact tool-loop output under the hard cap", () => {
    expect(resolveToolLoopMaxOutputTokens(30_000)).toBe(3_600);
    expect(resolveToolLoopMaxOutputTokens(45_000)).toBe(
      COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP,
    );
    expect(resolveToolLoopMaxOutputTokens(45_000)).toBe(5_000);
    expect(resolveToolLoopMaxOutputTokens(45_000)).toBeLessThan(13_500);
  });

  it("grows as the advertised window grows", () => {
    expect(resolveToolLoopMaxOutputTokens(30_000)).toBeLessThan(
      resolveToolLoopMaxOutputTokens(65_000),
    );
    expect(resolveToolLoopMaxOutputTokens(65_000)).toBeLessThan(
      resolveToolLoopMaxOutputTokens(128_000),
    );
    expect(resolveToolLoopMaxOutputTokens(128_000)).toBeLessThan(
      resolveToolLoopMaxOutputTokens(256_000),
    );
  });

  it("honors host outputWindowCapRatio overrides", () => {
    expect(
      resolveToolLoopMaxOutputTokens(100_000, { outputWindowCapRatio: 0.1 }),
    ).toBe(10_000);
  });
});
