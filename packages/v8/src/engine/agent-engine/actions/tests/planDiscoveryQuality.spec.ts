import { describe, expect, it } from "vitest";

import {
  clarifyAfterInsufficientPlanDiscovery,
  isPlanDiscoveryEvidenceSufficient,
  isThoroughPlanDiscoveryEvidenceSufficient,
  requiresPlanDiscoveryQualityFloor,
  usesThoroughPlanDiscoveryEvidence,
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

  it("skips for Plan quick and ask mode", () => {
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "plan",
        explorationDepth: "quick",
      }),
    ).toBe(false);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "ask",
        explorationDepth: "deep",
      }),
    ).toBe(false);
  });

  it("requires a floor for Agent visible / wide-internal big tasks", () => {
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "deep",
      }),
    ).toBe(false);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "auto",
        planningDepth: "visible",
      }),
    ).toBe(true);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "auto",
        planningDepth: "internal",
        agentWideScope: true,
      }),
    ).toBe(true);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "auto",
        planningDepth: "internal",
        agentWideScope: false,
      }),
    ).toBe(false);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "quick",
        planningDepth: "visible",
      }),
    ).toBe(false);
  });
});

describe("isPlanDiscoveryEvidenceSufficient", () => {
  it("requires reads, surfaces, and non-low confidence (base)", () => {
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

  it("thorough bar requires multi-file multi-surface evidence", () => {
    expect(
      isThoroughPlanDiscoveryEvidenceSufficient({
        filesRead: [{ path: "a.ts", reason: "seed" }],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
        ],
        confidence: "medium",
      }),
    ).toBe(false);

    expect(
      isThoroughPlanDiscoveryEvidenceSufficient({
        filesRead: [
          { path: "a.ts", reason: "seed" },
          { path: "b.ts", reason: "seed" },
        ],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
        ],
        confidence: "medium",
      }),
    ).toBe(true);

    expect(
      isPlanDiscoveryEvidenceSufficient(
        {
          filesRead: [
            { path: "a.ts", reason: "seed" },
            { path: "b.ts", reason: "seed" },
          ],
          proposedChangeSurfaces: [
            { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
          ],
          confidence: "high",
        },
        { thorough: true },
      ),
    ).toBe(true);
  });
});

describe("usesThoroughPlanDiscoveryEvidence", () => {
  it("is true for Plan and Agent visible", () => {
    expect(usesThoroughPlanDiscoveryEvidence({ mode: "plan" })).toBe(true);
    expect(
      usesThoroughPlanDiscoveryEvidence({
        mode: "agent",
        planningDepth: "visible",
      }),
    ).toBe(true);
    expect(
      usesThoroughPlanDiscoveryEvidence({
        mode: "agent",
        planningDepth: "internal",
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

  it("uses thorough rationale when requested", () => {
    const decision = clarifyAfterInsufficientPlanDiscovery(0.4, {
      thorough: true,
    });
    expect(decision.rationale).toMatch(/multi-file/i);
  });
});
