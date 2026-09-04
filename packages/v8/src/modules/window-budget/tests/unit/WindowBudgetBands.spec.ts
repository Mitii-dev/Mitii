import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_BAND_CEILINGS,
  WINDOW_BUDGET_BAND_TABLE,
  resolveWindowBudgetBand,
  listWindowBudgetBands,
} from "../../windowBudgetBands";
import { resolveWindowBudgetPolicy } from "../../policy";
import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../../index";

describe("resolveWindowBudgetBand", () => {
  it("maps windows into compact / standard / wide", () => {
    expect(resolveWindowBudgetBand(1)).toBe("compact");
    expect(
      resolveWindowBudgetBand(
        WINDOW_BUDGET_BAND_CEILINGS.compactMaxExclusive - 1,
      ),
    ).toBe("compact");
    expect(
      resolveWindowBudgetBand(WINDOW_BUDGET_BAND_CEILINGS.compactMaxExclusive),
    ).toBe("standard");
    expect(
      resolveWindowBudgetBand(
        WINDOW_BUDGET_BAND_CEILINGS.standardMaxExclusive - 1,
      ),
    ).toBe("standard");
    expect(
      resolveWindowBudgetBand(WINDOW_BUDGET_BAND_CEILINGS.standardMaxExclusive),
    ).toBe("wide");
  });

  it("lists three band definitions", () => {
    expect(listWindowBudgetBands().map((band) => band.id)).toEqual([
      "compact",
      "standard",
      "wide",
    ]);
  });
});

describe("resolveWindowBudgetPolicy", () => {
  it("applies compact mutation cap", () => {
    const resolved = resolveWindowBudgetPolicy({
      contextWindowTokens: 35_000,
    });
    expect(resolved.band).toBe("compact");
    expect(resolved.policy.maxUniqueFilesPerCallCap).toBe(
      WINDOW_BUDGET_BAND_TABLE.compact.overrides.maxUniqueFilesPerCallCap,
    );
    expect(resolved.policy.skillsShare).toBe(
      WINDOW_BUDGET_BAND_TABLE.compact.overrides.skillsShare,
    );
  });

  it("applies explicit standard band knobs", () => {
    const resolved = resolveWindowBudgetPolicy({
      contextWindowTokens: 75_000,
    });
    expect(resolved.band).toBe("standard");
    expect(resolved.policy.outputRatio).toBe(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.outputRatio,
    );
    expect(resolved.policy.outputWindowCapRatio).toBe(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.outputWindowCapRatio,
    );
    expect(resolved.policy.outputMinTokens).toBe(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.outputMinTokens,
    );
    expect(resolved.policy.repositoryShare).toBe(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.repositoryShare,
    );
    expect(resolved.policy.conversationShare).toBe(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.conversationShare,
    );
    expect(resolved.policy.skillsShare).toBe(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.skillsShare,
    );
    expect(resolved.policy.maxUniqueFilesPerCallCap).toBe(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.maxUniqueFilesPerCallCap,
    );
    expect(resolved.policy.maxSkillsCap).toBe(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.maxSkillsCap,
    );
  });

  it("applies explicit wide band knobs", () => {
    const resolved = resolveWindowBudgetPolicy({
      contextWindowTokens: 128_000,
    });
    expect(resolved.band).toBe("wide");
    expect(resolved.policy.outputRatio).toBe(
      WINDOW_BUDGET_BAND_TABLE.wide.overrides.outputRatio,
    );
    expect(resolved.policy.outputWindowCapRatio).toBe(
      WINDOW_BUDGET_BAND_TABLE.wide.overrides.outputWindowCapRatio,
    );
    expect(resolved.policy.repositoryShare).toBe(
      WINDOW_BUDGET_BAND_TABLE.wide.overrides.repositoryShare,
    );
    expect(resolved.policy.maxUniqueFilesPerCallCap).toBe(
      WINDOW_BUDGET_BAND_TABLE.wide.overrides.maxUniqueFilesPerCallCap,
    );
    expect(resolved.policy.maxSkillsCap).toBe(
      WINDOW_BUDGET_BAND_TABLE.wide.overrides.maxSkillsCap,
    );
  });

  it("lets host overrides win over the band", () => {
    const resolved = resolveWindowBudgetPolicy({
      contextWindowTokens: 35_000,
      overrides: { maxUniqueFilesPerCallCap: 3 },
    });
    expect(resolved.policy.maxUniqueFilesPerCallCap).toBe(3);
  });
});

describe("deriveWindowPolicy band effects", () => {
  it("caps compact mutation files at the band ceiling", () => {
    const result = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 35_000,
    });
    expect(result.mutation.maxUniqueFilesPerCall).toBeLessThanOrEqual(6);
  });

  it("allows more skills on wide windows", () => {
    const wide = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 128_000,
    });
    expect(wide.skills.maxSkills).toBeGreaterThanOrEqual(4);
  });
});
