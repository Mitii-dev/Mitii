import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_BAND,
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
  resolveWindowBudgetBand,
} from "../../index";

/**
 * Golden snapshots for the three shipped window bands.
 * Lock band id + key allocation fields so refactors cannot silently drift.
 */
describe("window-budget goldens", () => {
  it("30k → compact", () => {
    expect(resolveWindowBudgetBand(30_000)).toBe(WINDOW_BUDGET_BAND.compact);
    const policy = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
    });
    expect(policy.effort).toBe("medium");
    expect(policy.maximumOutputTokens).toBeGreaterThan(0);
    expect(policy.usableInputTokens).toBeGreaterThan(0);
    expect(policy.sections.repositoryTokens).toBeGreaterThan(0);
    expect(policy.planning.budgetTokens).toBeGreaterThan(0);
    expect(policy.reasonCodes).toContain("output_derived_from_window");
    expect(policy.reasonCodes).toContain("effort_medium");
  });

  it("100k → wide (at standard ceiling)", () => {
    expect(resolveWindowBudgetBand(100_000)).toBe(WINDOW_BUDGET_BAND.wide);
    const policy = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 100_000,
    });
    expect(policy.usableInputTokens).toBeGreaterThan(50_000);
    expect(policy.sections.planTokens).toBeGreaterThan(0);
    expect(policy.mutation.maxUniqueFilesPerCall).toBeGreaterThan(0);
  });

  it("200k → wide with larger sections than 30k", () => {
    expect(resolveWindowBudgetBand(200_000)).toBe(WINDOW_BUDGET_BAND.wide);
    const compact = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
    });
    const wide = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 200_000,
    });
    expect(wide.usableInputTokens).toBeGreaterThan(compact.usableInputTokens);
    expect(wide.sections.repositoryTokens).toBeGreaterThan(
      compact.sections.repositoryTokens,
    );
    expect(wide.carry.maxMessages).toBeGreaterThan(compact.carry.maxMessages);
  });
});
