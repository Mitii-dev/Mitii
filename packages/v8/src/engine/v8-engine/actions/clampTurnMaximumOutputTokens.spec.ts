import { describe, expect, it } from "vitest";

import { clampTurnMaximumOutputTokens } from "./clampTurnMaximumOutputTokens";

describe("clampTurnMaximumOutputTokens", () => {
  it("caps answer-only leftover by provider maximum output tokens", () => {
    // Mirrors the failed deepseek-v4-pro run: 150k window, ~19k input,
    // answer-lock (no tools) → leftover × 0.95 ≈ 124k, provider max 65_536.
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 149_999,
        contextWindowTokens: 150_000,
        usedInputTokens: 19_000,
        toolLoop: false,
        providerMaximumOutputTokens: 65_536,
      }),
    ).toBe(65_536);
  });

  it("keeps tool-loop ceiling when it is below the provider max", () => {
    const withoutProvider = clampTurnMaximumOutputTokens({
      reservedOutputTokens: 149_999,
      contextWindowTokens: 150_000,
      usedInputTokens: 19_000,
      toolLoop: true,
    });
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 149_999,
        contextWindowTokens: 150_000,
        usedInputTokens: 19_000,
        toolLoop: true,
        providerMaximumOutputTokens: 65_536,
      }),
    ).toBe(withoutProvider);
    expect(withoutProvider).toBeLessThanOrEqual(65_536);
  });

  it("ignores non-positive provider maxima", () => {
    const baseline = clampTurnMaximumOutputTokens({
      reservedOutputTokens: 149_999,
      contextWindowTokens: 150_000,
      usedInputTokens: 19_000,
      toolLoop: false,
    });
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 149_999,
        contextWindowTokens: 150_000,
        usedInputTokens: 19_000,
        toolLoop: false,
        providerMaximumOutputTokens: 0,
      }),
    ).toBe(baseline);
  });
});
