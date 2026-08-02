import { describe, expect, it } from "vitest";

import { deriveContextSelectionBudget } from "../policy";

describe("deriveContextSelectionBudget", () => {
  it("floors at default selection limits for small windows", () => {
    const budget = deriveContextSelectionBudget(8_192);
    expect(budget.maximumTokens).toBe(12_000);
    expect(budget.maximumItems).toBe(24);
    expect(budget.maximumFiles).toBe(16);
  });

  it("scales selection budget with large context windows", () => {
    const budget = deriveContextSelectionBudget(252_000);
    expect(budget.maximumTokens).toBe(63_000);
    expect(budget.maximumItems).toBe(126);
    expect(budget.maximumFiles).toBe(84);
  });
});
