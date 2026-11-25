import { describe, expect, it } from "vitest";

import {
  COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP,
  resolveToolLoopMaxOutputTokens,
  resolveWindowBudgetPolicy,
  WINDOW_BUDGET_BAND_CEILINGS,
} from "../../index";

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
    expect(resolveToolLoopMaxOutputTokens(30_000)).toBeLessThanOrEqual(
      COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP,
    );
    expect(resolveToolLoopMaxOutputTokens(45_000)).toBeLessThanOrEqual(
      COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP,
    );
  });
});
