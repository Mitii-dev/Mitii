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
    // 50k window, ~20k input, ~15k generation ceiling -> cap at 8k.
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 14_999,
        contextWindowTokens: 50_000,
        usedInputTokens: 20_000,
        toolLoop: true,
      }),
    ).toBe(8_192);

    // High ceiling + large leftover: still bounded for local model stability.
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 29_999,
        contextWindowTokens: 65_000,
        usedInputTokens: 10_000,
        toolLoop: true,
      }),
    ).toBe(8_192);

    // Compact windows get a smaller but still useful tool-loop cap.
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 29_999,
        contextWindowTokens: 35_000,
        usedInputTokens: 10_000,
        toolLoop: true,
      }),
    ).toBe(4_096);
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
