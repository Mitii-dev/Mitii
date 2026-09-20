import { describe, expect, it } from "vitest";

import {
  isArchitectureIntentTaxonomy,
  isRepairIntentTaxonomy,
} from "../patterns";

describe("repair vs architecture intent taxonomy", () => {
  it("treats bugfix/diagnose as repair and excludes refactor/migrate", () => {
    expect(isRepairIntentTaxonomy(["bugfix"])).toBe(true);
    expect(isRepairIntentTaxonomy(["diagnose"])).toBe(true);
    expect(isRepairIntentTaxonomy(["refactor"])).toBe(false);
    expect(isRepairIntentTaxonomy(["migrate"])).toBe(false);
    expect(isRepairIntentTaxonomy(["scaffold"])).toBe(false);
  });

  it("classifies refactor/migrate/scaffold as architecture intents", () => {
    expect(isArchitectureIntentTaxonomy(["refactor"])).toBe(true);
    expect(isArchitectureIntentTaxonomy(["migrate"])).toBe(true);
    expect(isArchitectureIntentTaxonomy(["scaffold"])).toBe(true);
    expect(isArchitectureIntentTaxonomy(["bugfix"])).toBe(false);
  });
});
