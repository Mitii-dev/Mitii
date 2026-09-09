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

  it("caps tool-loop turns while still allowing larger patch batches", () => {
    // Compact (<50k): 8k ceiling when leftover is larger.
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 29_999,
        contextWindowTokens: 45_000,
        usedInputTokens: 20_000,
        toolLoop: true,
      }),
    ).toBe(8_192);

    // Standard (50k–<100k): 10k ceiling.
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 29_999,
        contextWindowTokens: 65_000,
        usedInputTokens: 10_000,
        toolLoop: true,
      }),
    ).toBe(10_240);

    // Wide (≥100k): 12k ceiling — still far below full leftover.
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 49_999,
        contextWindowTokens: 128_000,
        usedInputTokens: 20_000,
        toolLoop: true,
      }),
    ).toBe(12_288);
  });

  it("never collapses a usable leftover window to a 1-token turn", () => {
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 8_192,
        contextWindowTokens: 30_000,
        usedInputTokens: 29_740,
        toolLoop: true,
      }),
    ).toBe(256);

    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 8_192,
        contextWindowTokens: 30_000,
        usedInputTokens: 29_900,
        toolLoop: true,
      }),
    ).toBe(99);
  });
});
