import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
  windowBudgetInputSchema,
  windowPolicySchema,
  WindowBudgetError,
} from "../../index";

describe("Window Budget contract", () => {
  it("accepts valid input and returns a versioned policy", () => {
    const result = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 100_000,
    });

    expect(result.schemaVersion).toBe(1);
    expect(windowPolicySchema.parse(result).usableInputTokens).toBeGreaterThan(
      0,
    );
    expect(result.reasonCodes).toContain("output_derived_from_window");
    expect(result.reasonCodes).toContain("tool_schema_fallback");
    expect(result.reasonCodes).toContain("effort_medium");
    expect(result.effort).toBe("medium");
  });

  it("rejects invalid input with a stable error code", () => {
    expect(() =>
      deriveWindowPolicy({
        schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
        contextWindowTokens: 0,
      }),
    ).toThrow(WindowBudgetError);

    try {
      deriveWindowPolicy({
        schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
        contextWindowTokens: 0,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(WindowBudgetError);
      expect((error as WindowBudgetError).code).toBe("invalid_input");
    }
  });

  it("keeps the public input schema on version 1", () => {
    const parsed = windowBudgetInputSchema.parse({
      schemaVersion: 1,
      contextWindowTokens: 32_768,
      maximumOutputTokens: 0,
      toolSchemaTokens: 0,
    });
    expect(parsed.schemaVersion).toBe(1);
  });
});
