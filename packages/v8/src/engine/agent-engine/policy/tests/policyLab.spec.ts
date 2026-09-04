import { describe, expect, it } from "vitest";

import {
  EMPTY_POLICY_LAB,
  parsePolicyLabFile,
  tryParsePolicyLabFile,
  promotePolicyLabToShip,
  resolvePolicyLabOverrides,
  mergeLabUnderHostOverrides,
  POLICY_LAB_SCHEMA_VERSION,
} from "../index";

describe("policyLabFileSchema", () => {
  it("parses a minimal enabled lab", () => {
    const lab = parsePolicyLabFile({
      schemaVersion: POLICY_LAB_SCHEMA_VERSION,
      enabled: true,
      loop: {
        compact: { maxReadOnlyToolTurnsBeforeMutationNudge: 12 },
      },
      window: {
        wide: { maxSkillsCap: 6 },
      },
    });
    expect(lab.enabled).toBe(true);
    expect(lab.loop.compact?.maxReadOnlyToolTurnsBeforeMutationNudge).toBe(12);
    expect(lab.window.wide?.maxSkillsCap).toBe(6);
  });

  it("soft-parses invalid input to empty lab", () => {
    expect(tryParsePolicyLabFile({ schemaVersion: 99 })).toEqual({
      ...EMPTY_POLICY_LAB,
    });
  });
});

describe("resolvePolicyLabOverrides", () => {
  it("returns nothing when lab is disabled", () => {
    const resolved = resolvePolicyLabOverrides({
      lab: {
        ...EMPTY_POLICY_LAB,
        enabled: false,
        loop: { compact: { explorationRereadMinCalls: 20 } },
      },
      contextWindowTokens: 35_000,
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.loopOverrides).toBeUndefined();
  });

  it("selects the compact band overrides when enabled", () => {
    const resolved = resolvePolicyLabOverrides({
      lab: {
        schemaVersion: 1,
        enabled: true,
        loop: { compact: { explorationRereadMinCalls: 20 } },
        window: { compact: { maxUniqueFilesPerCallCap: 4 } },
      },
      contextWindowTokens: 35_000,
    });
    expect(resolved.band).toBe("compact");
    expect(resolved.loopOverrides?.explorationRereadMinCalls).toBe(20);
    expect(resolved.windowOverrides?.maxUniqueFilesPerCallCap).toBe(4);
  });
});

describe("mergeLabUnderHostOverrides", () => {
  it("lets host Custom win over lab", () => {
    const merged = mergeLabUnderHostOverrides(
      { explorationRereadMinCalls: 12 },
      { explorationRereadMinCalls: 24 },
    );
    expect(merged?.explorationRereadMinCalls).toBe(24);
  });
});

describe("promotePolicyLabToShip", () => {
  it("emits TypeScript snippets for non-empty bands", () => {
    const result = promotePolicyLabToShip({
      lab: {
        schemaVersion: 1,
        enabled: true,
        loop: {
          compact: { maxRejectedMutationRecoveries: 5 },
        },
        window: {
          wide: { maxSkillsCap: 6 },
        },
      },
      bands: ["compact", "wide"],
    });
    expect(result.empty).toBe(false);
    expect(result.loopSnippet).toContain("compact:");
    expect(result.loopSnippet).toContain("maxRejectedMutationRecoveries: 5");
    expect(result.windowSnippet).toContain("wide:");
    expect(result.windowSnippet).toContain("maxSkillsCap: 6");
  });
});
