import { describe, expect, it } from "vitest";

import { resolveWindowBudgetPolicy } from "../../policy";
import { resolveToolLoopMaxOutputTokens } from "../../toolLoopOutputCaps";

describe("toolLoopOutputCaps", () => {
  it("scales continuously with context window × outputWindowCapRatio", () => {
    for (const window of [30_000, 45_000, 65_000, 100_000, 200_000, 256_000]) {
      const { policy } = resolveWindowBudgetPolicy({
        contextWindowTokens: window,
      });
      expect(resolveToolLoopMaxOutputTokens(window)).toBe(
        Math.floor(window * policy.outputWindowCapRatio),
      );
    }
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
