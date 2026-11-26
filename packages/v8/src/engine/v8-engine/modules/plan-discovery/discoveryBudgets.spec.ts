import { describe, expect, it } from "vitest";

import {
  resolveDiscoveryPassBudget,
  scaleDiscoveryPassBudget,
  DEFAULT_DISCOVERY_PASS_BUDGET,
  assertDiscoveryBudgetsMonotonic,
} from "./discoveryBudgets";

describe("resolveDiscoveryPassBudget", () => {
  it("is monotonic: compact ≤ standard ≤ wide per taskSize", () => {
    expect(() => assertDiscoveryBudgetsMonotonic()).not.toThrow();
    expect(resolveDiscoveryPassBudget("medium", "compact")).toMatchObject({
      maxModelTurns: 5,
      maxFileReads: 10,
    });
    expect(resolveDiscoveryPassBudget("medium", "standard")).toMatchObject({
      maxModelTurns: 6,
      maxFileReads: 12,
    });
    expect(resolveDiscoveryPassBudget("medium", "wide")).toMatchObject({
      maxModelTurns: 8,
      maxFileReads: 16,
    });
    expect(resolveDiscoveryPassBudget("small", "standard")).toMatchObject({
      maxModelTurns: 4,
      maxFileReads: 8,
    });
    expect(resolveDiscoveryPassBudget("large", "compact")).toMatchObject({
      maxModelTurns: 7,
      maxFileReads: 14,
    });
  });

  it("maps context-window token counts with larger windows getting more headroom", () => {
    expect(resolveDiscoveryPassBudget("medium", 40_000).maxModelTurns).toBe(5);
    expect(resolveDiscoveryPassBudget("medium", 80_000).maxModelTurns).toBe(6);
    expect(resolveDiscoveryPassBudget("medium", 120_000).maxModelTurns).toBe(8);
  });

  it("keeps search/tool caps proportional without unbounded explore", () => {
    const medium = resolveDiscoveryPassBudget("medium", "standard");
    expect(medium.maxSearches).toBeGreaterThanOrEqual(6);
    expect(medium.maxSearches).toBeLessThanOrEqual(24);
    expect(medium.maxToolCalls).toBeGreaterThanOrEqual(medium.maxFileReads);
    expect(medium.maxToolCalls).toBeLessThanOrEqual(36);
  });

  it("defaults unknown size to small standard-shaped envelope", () => {
    expect(resolveDiscoveryPassBudget(undefined, undefined).maxModelTurns).toBe(
      resolveDiscoveryPassBudget("small", "standard").maxModelTurns,
    );
    expect(DEFAULT_DISCOVERY_PASS_BUDGET.maxFileReads).toBe(8);
  });
});

describe("scaleDiscoveryPassBudget", () => {
  it("shrinks the envelope after scope lock without emptying it", () => {
    const base = resolveDiscoveryPassBudget("medium", "standard");
    const scaled = scaleDiscoveryPassBudget(base, 0.65);
    expect(scaled.maxModelTurns).toBeLessThan(base.maxModelTurns);
    expect(scaled.maxFileReads).toBeLessThan(base.maxFileReads);
    expect(scaled.maxModelTurns).toBeGreaterThanOrEqual(1);
    expect(scaled.maxFileReads).toBeGreaterThanOrEqual(2);
  });
});
