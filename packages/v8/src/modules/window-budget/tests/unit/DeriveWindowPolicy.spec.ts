import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../../index";

describe("deriveWindowPolicy", () => {
  it("scales usable input and section shares with the window", () => {
    const small = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
    });
    const large = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 100_000,
    });

    expect(small.maximumOutputTokens).toBeLessThan(large.maximumOutputTokens);
    expect(small.usableInputTokens).toBeLessThan(large.usableInputTokens);
    expect(small.sections.repositoryTokens).toBeLessThan(
      large.sections.repositoryTokens,
    );
    expect(small.planning.visiblePlanAffordable).toBe(false);
    expect(large.planning.visiblePlanAffordable).toBe(true);
    expect(small.mutation.maxUniqueFilesPerCall).toBeLessThanOrEqual(
      large.mutation.maxUniqueFilesPerCall,
    );
    expect(small.run.maxModelCalls).toBeLessThanOrEqual(large.run.maxModelCalls);
  });

  it("treats a positive maximumOutputTokens as a host override", () => {
    const result = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
      maximumOutputTokens: 4_096,
    });
    expect(result.maximumOutputTokens).toBe(4_096);
    expect(result.reasonCodes).toContain("output_host_override");
  });

  it("uses measured tool schema tokens when provided", () => {
    const result = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 100_000,
      toolSchemaTokens: 12_000,
    });
    expect(result.toolSchemaTokens).toBe(12_000);
    expect(result.reasonCodes).toContain("tool_schema_measured");
    expect(result.usableInputTokens).toBe(
      100_000 - result.maximumOutputTokens - 12_000,
    );
  });

  it("applies policy overrides instead of buried constants", () => {
    const result = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
      policy: {
        outputRatio: 0.05,
        visiblePlanMinUsableTokens: 1,
        repositoryShare: 0.5,
      },
    });
    expect(result.planning.visiblePlanAffordable).toBe(true);
    expect(result.resolvedPolicy.outputRatio).toBe(0.05);
    expect(result.sections.repositoryTokens).toBeGreaterThan(
      Math.floor(result.usableInputTokens * 0.4),
    );
  });

  it("never allocates more than the window", () => {
    const result = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 8_192,
      toolSchemaTokens: 20_000,
    });
    expect(
      result.maximumOutputTokens +
        result.toolSchemaTokens +
        result.usableInputTokens,
    ).toBeLessThanOrEqual(8_192);
    expect(result.loopInputBudgetTokens).toBeGreaterThan(0);
  });
});
