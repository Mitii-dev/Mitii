import { describe, expect, it } from "vitest";

import {
  assertDiscoveryBudgetsMonotonic,
  resolveDiscoveryPassBudget,
} from "../../rules/discoveryPassBudgets";

describe("discoveryPassBudgets (window-budget owner)", () => {
  it("never shrinks headroom when the window band grows", () => {
    expect(() => assertDiscoveryBudgetsMonotonic()).not.toThrow();
    for (const size of ["small", "medium", "large"] as const) {
      const compact = resolveDiscoveryPassBudget(size, "compact");
      const standard = resolveDiscoveryPassBudget(size, "standard");
      const wide = resolveDiscoveryPassBudget(size, "wide");
      expect(standard.maxModelTurns).toBeGreaterThanOrEqual(compact.maxModelTurns);
      expect(wide.maxModelTurns).toBeGreaterThanOrEqual(standard.maxModelTurns);
      expect(standard.maxFileReads).toBeGreaterThanOrEqual(compact.maxFileReads);
      expect(wide.maxFileReads).toBeGreaterThanOrEqual(standard.maxFileReads);
    }
  });
});
