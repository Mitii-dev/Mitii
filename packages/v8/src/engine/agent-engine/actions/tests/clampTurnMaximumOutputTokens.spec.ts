import { describe, expect, it } from "vitest";

import { clampTurnMaximumOutputTokens } from "../clampTurnMaximumOutputTokens";

describe("clampTurnMaximumOutputTokens", () => {
  it("keeps a real host ceiling when leftover context is larger", () => {
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 3_000,
        contextWindowTokens: 30_000,
        usedInputTokens: 12_000,
      }),
    ).toBe(3_000);
  });

  it("fills leftover context when the generation ceiling is the window", () => {
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 29_999,
        contextWindowTokens: 30_000,
        usedInputTokens: 20_000,
      }),
    ).toBe(9_500);
  });

  it("shrinks output when the current prompt leaves less room than the ceiling", () => {
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 3_000,
        contextWindowTokens: 30_000,
        usedInputTokens: 28_000,
      }),
    ).toBe(1_900);
  });

  it("applies the band tool-loop ceiling on tool-capable turns", () => {
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 29_999,
        contextWindowTokens: 65_000,
        usedInputTokens: 10_000,
        toolLoop: true,
      }),
    ).toBe(3_072);
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 29_999,
        contextWindowTokens: 35_000,
        usedInputTokens: 8_000,
        toolLoop: true,
      }),
    ).toBe(2_048);
  });
});
