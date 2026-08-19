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
      contextWindowTokens: 300_000,
    });

    expect(small.maximumOutputTokens).toBeLessThan(large.maximumOutputTokens);
    expect(small.usableInputTokens).toBeLessThan(large.usableInputTokens);
    expect(small.sections.repositoryTokens).toBeLessThan(
      large.sections.repositoryTokens,
    );
    expect(small.planning.visiblePlanAffordable).toBe(true);
    expect(small.planning.changeImpactAffordable).toBe(true);
    expect(small.skills.maxSkills).toBeGreaterThanOrEqual(2);
    expect(small.mutation.maxPatchesPerCall).toBeGreaterThanOrEqual(
      small.mutation.maxUniqueFilesPerCall,
    );
    expect(large.planning.visiblePlanAffordable).toBe(true);
    expect(small.mutation.maxUniqueFilesPerCall).toBeLessThan(
      large.mutation.maxUniqueFilesPerCall,
    );
    expect(small.effort).toBe("medium");
    expect(small.run.maxModelCalls).toBe(64);
    expect(small.run.maxModelCalls).toBe(large.run.maxModelCalls);
    expect(small.run.maxVerificationRepairs).toBe(8);
    expect(small.compaction.toolResultContentChars).toBeLessThan(
      large.compaction.toolResultContentChars,
    );
    expect(small.compaction.droppedTurnSummaryChars).toBeLessThan(
      large.compaction.droppedTurnSummaryChars,
    );
    expect(small.compaction.maxEstablishedFacts).toBeLessThanOrEqual(
      large.compaction.maxEstablishedFacts,
    );
  });

  it("scales files per mutation with the context window, not the output ceiling", () => {
    const at30k = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
    });
    const at200k = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 200_000,
    });
    expect(at30k.mutation.maxUniqueFilesPerCall).toBe(7);
    expect(at30k.maximumOutputTokens).toBe(10_240);
    expect(at200k.mutation.maxUniqueFilesPerCall).toBe(8);
    expect(at200k.reasonCodes).toContain("mutation_effort_capped");
    expect(at200k.reasonCodes).toContain("effort_medium");
    expect(at200k.compaction.autoMaxTokens).toBe(32_000);
    expect(at200k.compaction.hardMaxTokens).toBe(40_000);
    expect(at200k.maximumOutputTokens).toBe(32_768);
    expect(at200k.maximumOutputTokens).toBeGreaterThan(
      at30k.maximumOutputTokens,
    );
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

  it("ignores the legacy 5000 output default and derives from the window", () => {
    const derived = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 35_000,
    });
    const legacy = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 35_000,
      maximumOutputTokens: 5_000,
    });
    expect(legacy.maximumOutputTokens).toBe(derived.maximumOutputTokens);
    expect(legacy.maximumOutputTokens).toBeGreaterThan(5_000);
    expect(legacy.reasonCodes).toContain("output_legacy_default_ignored");
    expect(legacy.reasonCodes).toContain("output_derived_from_window");
    expect(legacy.reasonCodes).not.toContain("output_host_override");
  });

  it("keeps plan and change-impact affordable on a 30k window with a 5k output cap", () => {
    const result = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
      maximumOutputTokens: 5_000,
    });
    expect(result.planning.visiblePlanAffordable).toBe(true);
    expect(result.planning.changeImpactAffordable).toBe(true);
    expect(result.skills.maxSkills).toBeGreaterThanOrEqual(2);
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

  it("derives compaction budgets from usable input and policy overrides", () => {
    const result = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 60_000,
      policy: {
        toolResultContentCharsRatio: 0.02,
        toolResultContentCharsMin: 100,
        toolResultContentCharsMax: 50_000,
        establishedFactCountRatio: 0.001,
        establishedFactCountMin: 2,
        establishedFactCountMax: 100,
      },
    });

    expect(result.compaction.toolResultContentChars).toBe(
      Math.floor(result.usableInputTokens * 0.02),
    );
    expect(result.compaction.maxEstablishedFacts).toBe(
      Math.floor(result.usableInputTokens * 0.001),
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

  it("applies named effort overlays without changing the advertised window", () => {
    const medium = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 200_000,
    });
    const high = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 200_000,
      effort: "high",
    });
    const low = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 200_000,
      effort: "low",
    });

    expect(medium.contextWindowTokens).toBe(200_000);
    expect(high.contextWindowTokens).toBe(200_000);
    expect(low.mutation.maxUniqueFilesPerCall).toBe(4);
    expect(medium.mutation.maxUniqueFilesPerCall).toBe(8);
    expect(high.mutation.maxUniqueFilesPerCall).toBe(12);
    expect(low.run.maxModelCalls).toBe(24);
    expect(low.run.maxToolCalls).toBe(48);
    expect(medium.run.maxToolCalls).toBe(128);
    expect(medium.run.maxModelCalls).toBe(64);
    expect(high.run.maxModelCalls).toBe(96);
    expect(high.run.maxToolCalls).toBe(192);
    expect(low.run.maxVerificationRepairs).toBe(0);
    expect(high.run.maxVerificationRepairs).toBe(12);
    expect(high.reasonCodes).toContain("effort_high");
  });
});
