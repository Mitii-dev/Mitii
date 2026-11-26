import { describe, expect, it } from "vitest";

import {
  clarifyAfterInsufficientPlanDiscovery,
  countProductiveDiscoveryReads,
  isPlanDiscoveryEvidenceSufficient,
  isProductiveDiscoveryReadPath,
  isThoroughPlanDiscoveryEvidenceSufficient,
  requiresPlanDiscoveryQualityFloor,
  resolvePlanDiscoveryMinSearches,
  shouldClarifyAfterPlanDiscovery,
  shouldPreferDiscoverySymbolEvidence,
  shouldRequireDiscoverySymbolEvidence,
  usesThoroughPlanDiscoveryEvidence,
} from "../../helpers/plan-discovery/PlanDiscoveryQuality";

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

  it("requires a floor for Agent medium/large taskSize even on internal depth", () => {
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "auto",
        planningDepth: "internal",
        agentWideScope: false,
        taskSize: "medium",
      }),
    ).toBe(true);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "auto",
        planningDepth: "none",
        taskSize: "large",
      }),
    ).toBe(true);
    expect(
      requiresPlanDiscoveryQualityFloor({
        mode: "agent",
        explorationDepth: "auto",
        planningDepth: "internal",
        taskSize: "small",
      }),
    ).toBe(false);
  });
});

