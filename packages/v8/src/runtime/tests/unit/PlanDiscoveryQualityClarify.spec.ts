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

describe("shouldClarifyAfterPlanDiscovery", () => {
  it("clarifies only when quality floor is on and discovery failed", () => {
    expect(
      shouldClarifyAfterPlanDiscovery({
        qualityFloor: true,
        discoveryFailed: true,
      }),
    ).toBe(true);
    expect(
      shouldClarifyAfterPlanDiscovery({
        qualityFloor: true,
        discoveryFailed: false,
      }),
    ).toBe(false);
    expect(
      shouldClarifyAfterPlanDiscovery({
        qualityFloor: false,
        discoveryFailed: true,
      }),
    ).toBe(false);
  });
});

describe("resolvePlanDiscoveryMinSearches", () => {
  it("requires a search for all thorough Plan discovery", () => {
    expect(
      resolvePlanDiscoveryMinSearches({ thorough: true, taskSize: "medium" }),
    ).toBe(1);
    expect(
      resolvePlanDiscoveryMinSearches({ thorough: true, taskSize: "large" }),
    ).toBe(1);
    expect(
      resolvePlanDiscoveryMinSearches({ thorough: true, taskSize: "small" }),
    ).toBe(1);
    expect(
      resolvePlanDiscoveryMinSearches({ thorough: false, taskSize: "medium" }),
    ).toBe(0);
  });
});

describe("shouldRequireDiscoverySymbolEvidence", () => {
  it("requires symbol tools when thorough and navigation is available", () => {
    expect(
      shouldRequireDiscoverySymbolEvidence({
        thorough: true,
        allowedTools: ["read_file", "document_symbol", "goto_definition"],
        reasonCodes: ["code_navigation_available"],
        codeIntelligenceToolIds: ["document_symbol", "goto_definition"],
      }),
    ).toBe(true);
    expect(
      shouldRequireDiscoverySymbolEvidence({
        thorough: true,
        allowedTools: ["read_file", "document_symbol"],
        reasonCodes: ["code_navigation_unavailable"],
        codeIntelligenceToolIds: ["document_symbol"],
      }),
    ).toBe(false);
    expect(
      shouldRequireDiscoverySymbolEvidence({
        thorough: false,
        allowedTools: ["document_symbol"],
        reasonCodes: [],
        codeIntelligenceToolIds: ["document_symbol"],
      }),
    ).toBe(false);
    expect(
      shouldRequireDiscoverySymbolEvidence({
        thorough: true,
        allowedTools: ["document_symbol"],
        reasonCodes: [],
        codeIntelligenceToolIds: ["document_symbol"],
        supportsForcedToolChoice: false,
      }),
    ).toBe(false);
  });
});

describe("shouldPreferDiscoverySymbolEvidence", () => {
  it("stays true when forced tool choice is unavailable", () => {
    expect(
      shouldPreferDiscoverySymbolEvidence({
        thorough: true,
        allowedTools: ["document_symbol"],
        reasonCodes: [],
        codeIntelligenceToolIds: ["document_symbol"],
      }),
    ).toBe(true);
  });

  it("nudges symbols for medium preferSymbols without thorough", () => {
    expect(
      shouldPreferDiscoverySymbolEvidence({
        thorough: false,
        preferSymbols: true,
        allowedTools: ["goto_definition", "find_references"],
        reasonCodes: [],
        codeIntelligenceToolIds: ["goto_definition", "find_references"],
      }),
    ).toBe(true);
    expect(
      shouldPreferDiscoverySymbolEvidence({
        thorough: false,
        preferSymbols: false,
        allowedTools: ["goto_definition"],
        reasonCodes: [],
        codeIntelligenceToolIds: ["goto_definition"],
      }),
    ).toBe(false);
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
