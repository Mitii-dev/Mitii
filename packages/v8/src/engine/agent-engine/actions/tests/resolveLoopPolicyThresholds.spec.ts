import { describe, expect, it } from "vitest";

import { AGENT_ENGINE_THRESHOLDS } from "../../policy";
import {
  LOOP_POLICY_WINDOW_BAND_CEILINGS,
  LOOP_POLICY_WINDOW_BAND_TABLE,
  resolveLoopPolicyWindowBand,
  listLoopPolicyWindowBands,
} from "../../policy/loopPolicyBands";
import {
  resolveLoopPolicyThresholds,
  resolveLoopPolicyBandThresholds,
} from "../resolveLoopPolicyThresholds";

describe("resolveLoopPolicyWindowBand", () => {
  it("maps windows into compact / standard / wide", () => {
    expect(resolveLoopPolicyWindowBand(1)).toBe("compact");
    expect(resolveLoopPolicyWindowBand(35_000)).toBe("compact");
    expect(
      resolveLoopPolicyWindowBand(
        LOOP_POLICY_WINDOW_BAND_CEILINGS.compactMaxExclusive - 1,
      ),
    ).toBe("compact");
    expect(
      resolveLoopPolicyWindowBand(
        LOOP_POLICY_WINDOW_BAND_CEILINGS.compactMaxExclusive,
      ),
    ).toBe("standard");
    expect(resolveLoopPolicyWindowBand(75_000)).toBe("standard");
    expect(
      resolveLoopPolicyWindowBand(
        LOOP_POLICY_WINDOW_BAND_CEILINGS.standardMaxExclusive - 1,
      ),
    ).toBe("standard");
    expect(
      resolveLoopPolicyWindowBand(
        LOOP_POLICY_WINDOW_BAND_CEILINGS.standardMaxExclusive,
      ),
    ).toBe("wide");
    expect(resolveLoopPolicyWindowBand(200_000)).toBe("wide");
  });

  it("falls back to compact for invalid windows", () => {
    expect(resolveLoopPolicyWindowBand(0)).toBe("compact");
    expect(resolveLoopPolicyWindowBand(-1)).toBe("compact");
    expect(resolveLoopPolicyWindowBand(Number.NaN)).toBe("compact");
  });

  it("lists three band definitions", () => {
    expect(listLoopPolicyWindowBands().map((band) => band.id)).toEqual([
      "compact",
      "standard",
      "wide",
    ]);
  });
});

describe("resolveLoopPolicyThresholds", () => {
  it("uses compact overrides for small windows", () => {
    const resolved = resolveLoopPolicyThresholds({
      contextWindowTokens: 35_000,
    });
    expect(resolved.band).toBe("compact");
    expect(resolved.thresholds.explorationRereadMinCalls).toBe(
      LOOP_POLICY_WINDOW_BAND_TABLE.compact.overrides.explorationRereadMinCalls,
    );
    expect(resolved.thresholds.maxReadOnlyToolTurnsBeforeMutationNudge).toBe(
      LOOP_POLICY_WINDOW_BAND_TABLE.compact.overrides
        .maxReadOnlyToolTurnsBeforeMutationNudge,
    );
    expect(resolved.thresholds.maxRejectedMutationRecoveries).toBe(
      LOOP_POLICY_WINDOW_BAND_TABLE.compact.overrides
        .maxRejectedMutationRecoveries,
    );
  });

  it("keeps base standards for the standard band", () => {
    const resolved = resolveLoopPolicyBandThresholds(75_000);
    expect(resolved.band).toBe("standard");
    expect(resolved.thresholds).toEqual({ ...AGENT_ENGINE_THRESHOLDS });
  });

  it("applies wide-band overrides", () => {
    const resolved = resolveLoopPolicyThresholds({
      contextWindowTokens: 128_000,
    });
    expect(resolved.band).toBe("wide");
    expect(resolved.thresholds.maxRecoveredAnalysisChars).toBe(
      LOOP_POLICY_WINDOW_BAND_TABLE.wide.overrides.maxRecoveredAnalysisChars,
    );
  });

  it("applies lab overrides on top of the active band", () => {
    const resolved = resolveLoopPolicyThresholds({
      contextWindowTokens: 35_000,
      overrides: {
        maxReadOnlyToolTurnsBeforeMutationNudge: 14,
        maxRejectedMutationRecoveries: 5,
      },
    });
    expect(resolved.band).toBe("compact");
    // Lab wins for overridden keys.
    expect(resolved.thresholds.maxReadOnlyToolTurnsBeforeMutationNudge).toBe(14);
    expect(resolved.thresholds.maxRejectedMutationRecoveries).toBe(5);
    // Unspecified keys keep compact band values.
    expect(resolved.thresholds.explorationRereadMinCalls).toBe(
      LOOP_POLICY_WINDOW_BAND_TABLE.compact.overrides.explorationRereadMinCalls,
    );
  });

  it("does not let empty lab overrides erase the band", () => {
    const withEmpty = resolveLoopPolicyThresholds({
      contextWindowTokens: 35_000,
      overrides: {},
    });
    const bandOnly = resolveLoopPolicyBandThresholds(35_000);
    expect(withEmpty.thresholds).toEqual(bandOnly.thresholds);
  });
});
