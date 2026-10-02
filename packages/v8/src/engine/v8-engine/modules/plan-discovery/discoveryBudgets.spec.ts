import { describe, expect, it } from "vitest";

import {
  resolveDiscoveryPassBudget,
  DEFAULT_DISCOVERY_PASS_BUDGET,
} from "./discoveryBudgets";

describe("resolveDiscoveryPassBudget", () => {
  it("uses the taskSize × window band table (turns = model/tool-loop turns)", () => {
    expect(resolveDiscoveryPassBudget("medium", "compact")).toMatchObject({
      maxModelTurns: 5,
      maxFileReads: 10,
    });
    expect(resolveDiscoveryPassBudget("medium", "standard")).toMatchObject({
      maxModelTurns: 4,
      maxFileReads: 8,
    });
    expect(resolveDiscoveryPassBudget("medium", "wide")).toMatchObject({
      maxModelTurns: 3,
      maxFileReads: 8,
    });
    expect(resolveDiscoveryPassBudget("small", "standard")).toMatchObject({
      maxModelTurns: 2,
      maxFileReads: 4,
    });
    expect(resolveDiscoveryPassBudget("large", "compact")).toMatchObject({
      maxModelTurns: 7,
      maxFileReads: 14,
    });
  });

  it("maps context-window token counts through the 100k band cutoff", () => {
    expect(resolveDiscoveryPassBudget("medium", 40_000).maxModelTurns).toBe(5);
    expect(resolveDiscoveryPassBudget("medium", 80_000).maxModelTurns).toBe(4);
    expect(resolveDiscoveryPassBudget("medium", 120_000).maxModelTurns).toBe(3);
  });

  it("keeps search/tool caps proportional without unbounded explore", () => {
    const medium = resolveDiscoveryPassBudget("medium", "standard");
    expect(medium.maxSearches).toBeGreaterThanOrEqual(6);
    expect(medium.maxSearches).toBeLessThanOrEqual(12);
    expect(medium.maxToolCalls).toBeGreaterThanOrEqual(medium.maxFileReads);
    expect(medium.maxToolCalls).toBeLessThanOrEqual(20);
  });

  it("defaults unknown size to small standard-shaped envelope", () => {
    expect(resolveDiscoveryPassBudget(undefined, undefined).maxModelTurns).toBe(
      resolveDiscoveryPassBudget("small", "standard").maxModelTurns,
    );
    expect(DEFAULT_DISCOVERY_PASS_BUDGET.maxFileReads).toBe(8);
  });
});
