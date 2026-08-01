import { describe, expect, it } from "vitest";

import { RunBudgetTracker } from "../RunBudget";

describe("RunBudgetTracker", () => {
  it("excludes suspended wait time from wall_time exhaustion", () => {
    const startedMs = 1_000_000;
    const budget = new RunBudgetTracker(
      {
        maxModelCalls: 10,
        maxToolCalls: 10,
        maxLoopIterations: 10,
        maxWallTimeMs: 5_000,
      },
      startedMs,
      undefined,
      0,
    );

    // 12s total wall, but 10s was user wait → 2s active.
    const now = startedMs + 12_000;
    expect(budget.activeElapsedMs(now)).toBe(12_000);
    budget.addExcludedWaitMs(10_000);
    expect(budget.activeElapsedMs(now)).toBe(2_000);

    // Patch Date.now for isExhausted.
    const realNow = Date.now;
    Date.now = () => now;
    try {
      expect(budget.isExhausted()).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it("still exhausts wall_time when active work exceeds the limit", () => {
    const startedMs = 1_000_000;
    const budget = new RunBudgetTracker(
      {
        maxModelCalls: 10,
        maxToolCalls: 10,
        maxLoopIterations: 10,
        maxWallTimeMs: 5_000,
      },
      startedMs,
      undefined,
      1_000,
    );

    const now = startedMs + 8_000; // 7s active after 1s excluded
    const realNow = Date.now;
    Date.now = () => now;
    try {
      expect(budget.isExhausted()).toBe("wall_time");
    } finally {
      Date.now = realNow;
    }
  });
});
