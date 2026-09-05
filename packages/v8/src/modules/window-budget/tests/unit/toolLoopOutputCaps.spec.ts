import { describe, expect, it } from "vitest";

import {
  TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND,
  resolveToolLoopMaxOutputTokens,
} from "../../toolLoopOutputCaps";

describe("toolLoopOutputCaps", () => {
  it("scales ceilings by window band", () => {
    expect(resolveToolLoopMaxOutputTokens(35_000)).toBe(
      TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND.compact,
    );
    expect(resolveToolLoopMaxOutputTokens(45_000)).toBe(8_192);
    expect(resolveToolLoopMaxOutputTokens(50_000)).toBe(10_240);
    expect(resolveToolLoopMaxOutputTokens(65_000)).toBe(10_240);
    expect(resolveToolLoopMaxOutputTokens(100_000)).toBe(12_288);
    expect(resolveToolLoopMaxOutputTokens(200_000)).toBe(12_288);
  });

  it("keeps compact below standard below wide", () => {
    expect(TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND.compact).toBeLessThan(
      TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND.standard,
    );
    expect(TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND.standard).toBeLessThan(
      TOOL_LOOP_MAX_OUTPUT_TOKENS_BY_BAND.wide,
    );
  });
});
