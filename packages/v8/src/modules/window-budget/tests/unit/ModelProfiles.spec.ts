import { describe, expect, it } from "vitest";

import { WINDOW_BUDGET_SCHEMA_VERSION } from "../../constants";
import { deriveWindowPolicy } from "../../actions/DeriveWindowPolicy";
import {
  WINDOW_BUDGET_MODEL_PROFILES,
  resolveWindowBudgetModelProfile,
  type WindowBudgetModelProfile,
} from "../../modelProfiles";
import { resolveWindowBudgetPolicy } from "../../policy";

const tightOutput: WindowBudgetModelProfile = {
  id: "tight-output",
  match: /^acme-/i,
  overrides: { outputWindowCapRatio: 0.05, outputRatio: 0.05 },
};

describe("window budget model profiles", () => {
  it("ships an empty table so default behavior is unchanged", () => {
    expect(WINDOW_BUDGET_MODEL_PROFILES).toHaveLength(0);
    const without = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 128_000,
    });
    const withModel = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 128_000,
      modelId: "deepseek-chat",
    });
    expect(withModel).toEqual(without);
    expect(withModel.reasonCodes).not.toContain("model_profile_applied");
  });

  it("matches the first profile case-insensitively and ignores blank ids", () => {
    expect(resolveWindowBudgetModelProfile("ACME-large", [tightOutput])).toBe(
      tightOutput,
    );
    expect(resolveWindowBudgetModelProfile("other", [tightOutput])).toBeUndefined();
    expect(resolveWindowBudgetModelProfile("  ", [tightOutput])).toBeUndefined();
    expect(resolveWindowBudgetModelProfile(undefined, [tightOutput])).toBeUndefined();
  });

  it("merges the profile between band and host overrides", () => {
    const base = resolveWindowBudgetPolicy({ contextWindowTokens: 128_000 });
    const profiled = resolveWindowBudgetPolicy({
      contextWindowTokens: 128_000,
      modelId: "acme-large",
      modelProfiles: [tightOutput],
    });
    expect(profiled.modelProfileId).toBe("tight-output");
    expect(profiled.policy.outputWindowCapRatio).toBe(0.05);
    expect(profiled.policy.outputWindowCapRatio).toBeLessThan(
      base.policy.outputWindowCapRatio,
    );

    const labWins = resolveWindowBudgetPolicy({
      contextWindowTokens: 128_000,
      modelId: "acme-large",
      modelProfiles: [tightOutput],
      overrides: { outputWindowCapRatio: 0.2 },
    });
    expect(labWins.policy.outputWindowCapRatio).toBe(0.2);
  });

  it("rejects an empty model id at the public boundary", () => {
    expect(() =>
      deriveWindowPolicy({
        schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
        contextWindowTokens: 128_000,
        modelId: "",
      }),
    ).toThrow(/schema validation/i);
  });
});
