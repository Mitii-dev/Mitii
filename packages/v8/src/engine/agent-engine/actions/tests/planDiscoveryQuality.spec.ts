import { describe, expect, it } from "vitest";

import {
  clarifyAfterInsufficientPlanDiscovery,
  isPlanDiscoveryEvidenceSufficient,
  requiresPlanDiscoveryQualityFloor,
} from "../planDiscoveryQuality";

describe("requiresPlanDiscoveryQualityFloor", () => {
  it("requires a quality floor for Plan at auto/deep", () => {
    expect(
      requiresPlanDiscoveryQualityFloor({ mode: "plan", explorationDepth: "auto" }),
    ).toBe(true);
    expect(
      requiresPlanDiscoveryQualityFloor({ mode: "plan", explorationDepth: "deep" }),
    ).toBe(true);
    expect(
      requiresPlanDiscoveryQualityFloor({ mode: "plan" }),
    ).toBe(true);
  });

  it("skips for Plan quick and non-plan modes", () => {
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "plan",
        explorationDepth: "quick",
      }),
    ).toBe(false);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "deep",
      }),
    ).toBe(false);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "ask",
        explorationDepth: "deep",
      }),
    ).toBe(false);
  });
});

describe("isPlanDiscoveryEvidenceSufficient", () => {
  it("requires reads, surfaces, and non-low confidence", () => {
    expect(
      isPlanDiscoveryEvidenceSufficient({
        filesRead: [{ path: "a.ts", reason: "seed" }],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
        ],
        confidence: "high",
      }),
    ).toBe(true);

    expect(
      isPlanDiscoveryEvidenceSufficient({
        filesRead: [],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "hit" },
        ],
        confidence: "high",
      }),
    ).toBe(false);

    expect(
      isPlanDiscoveryEvidenceSufficient({
        filesRead: [{ path: "a.ts", reason: "seed" }],
        proposedChangeSurfaces: [],
        confidence: "high",
      }),
    ).toBe(false);

    expect(
      isPlanDiscoveryEvidenceSufficient({
        filesRead: [{ path: "a.ts", reason: "seed" }],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
        ],
        confidence: "low",
      }),
    ).toBe(false);
  });
});

describe("clarifyAfterInsufficientPlanDiscovery", () => {
  it("returns a clarify strategy with skipDiscover", () => {
    const decision = clarifyAfterInsufficientPlanDiscovery(0.5);
    expect(decision.strategy).toBe("clarify");
    expect(decision.skipDiscover).toBe(true);
    expect(decision.confidence).toBe(0.5);
  });
});
