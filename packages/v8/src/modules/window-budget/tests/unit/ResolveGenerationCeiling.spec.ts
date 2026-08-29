import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
  resolveGenerationCeiling,
} from "../../index";

describe("resolveGenerationCeiling", () => {
  it("uses leftover window room when output is derived", () => {
    const policy = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
    });
    expect(
      resolveGenerationCeiling({
        contextWindowTokens: 30_000,
        configuredOutputTokens: policy.maximumOutputTokens,
        reasonCodes: policy.reasonCodes,
      }),
    ).toBe(29_999);
  });

  it("keeps a real host override as the hard cap", () => {
    const policy = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
      maximumOutputTokens: 4_096,
    });
    expect(
      resolveGenerationCeiling({
        contextWindowTokens: 30_000,
        configuredOutputTokens: policy.maximumOutputTokens,
        reasonCodes: policy.reasonCodes,
      }),
    ).toBe(4_096);
  });

  it("ignores the legacy 5000 default without reason codes", () => {
    expect(
      resolveGenerationCeiling({
        contextWindowTokens: 35_000,
        configuredOutputTokens: 5_000,
      }),
    ).toBe(34_999);
  });
});
