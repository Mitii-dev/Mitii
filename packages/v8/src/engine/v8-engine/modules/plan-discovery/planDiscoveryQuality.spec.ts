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
} from "./planDiscoveryQuality";

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

  it("rejects entry + package.json as thorough multi-file evidence", () => {
    expect(isProductiveDiscoveryReadPath("package.json")).toBe(false);
    expect(isProductiveDiscoveryReadPath("packages/runner/src/verifiers.js")).toBe(
      true,
    );
    expect(
      countProductiveDiscoveryReads([
        { path: "packages/runner/src/verifiers.js" },
        { path: "package.json" },
      ]),
    ).toBe(1);

    expect(
      isThoroughPlanDiscoveryEvidenceSufficient({
        filesRead: [
          { path: "packages/runner/src/verifiers.js", reason: "seed" },
          { path: "package.json", reason: "seed" },
        ],
        proposedChangeSurfaces: [
          {
            path: "packages/runner/src/verifiers.js",
            actionHint: "Change",
            riskLevel: "low",
            evidence: "read",
          },
        ],
        confidence: "medium",
      }),
    ).toBe(false);
  });

  it("thorough bar requires productive multi-file support beyond one surface", () => {
    expect(
      isThoroughPlanDiscoveryEvidenceSufficient({
        filesRead: [{ path: "a.ts", reason: "seed" }],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
        ],
        confidence: "medium",
      }),
    ).toBe(false);

    // Two productive reads but only the surface itself — needs related support.
    expect(
      isThoroughPlanDiscoveryEvidenceSufficient({
        filesRead: [
          { path: "a.ts", reason: "seed" },
          { path: "a.ts", reason: "reread" },
        ],
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
          { path: "b.ts", reason: "related" },
        ],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
        ],
        confidence: "medium",
      }),
    ).toBe(true);

    expect(
      isThoroughPlanDiscoveryEvidenceSufficient({
        filesRead: [
          { path: "a.ts", reason: "seed" },
          { path: "a.test.ts", reason: "test" },
        ],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
        ],
        confidence: "medium",
      }),
    ).toBe(true);

    expect(
      isThoroughPlanDiscoveryEvidenceSufficient({
        filesRead: [
          { path: "a.ts", reason: "seed" },
          { path: "b.ts", reason: "seed" },
        ],
        proposedChangeSurfaces: [
          { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
          { path: "b.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
        ],
        confidence: "medium",
      }),
    ).toBe(true);
  });

  it("thorough + minSearches requires searchCount", () => {
    const brief = {
      filesRead: [
        { path: "a.ts", reason: "seed" },
        { path: "b.ts", reason: "related" },
      ],
      proposedChangeSurfaces: [
        { path: "a.ts", actionHint: "Change" as const, riskLevel: "low" as const, evidence: "read" },
      ],
      confidence: "medium" as const,
    };
    expect(
      isPlanDiscoveryEvidenceSufficient(brief, {
        thorough: true,
        minSearches: 1,
        searchCount: 0,
      }),
    ).toBe(false);
    expect(
      isPlanDiscoveryEvidenceSufficient(brief, {
        thorough: true,
        minSearches: 1,
        searchCount: 1,
      }),
    ).toBe(true);
  });

  it("thorough + requireSymbolEvidence needs attached symbols on a read", () => {
    expect(
      isThoroughPlanDiscoveryEvidenceSufficient(
        {
          filesRead: [
            { path: "a.ts", reason: "seed" },
            { path: "b.ts", reason: "seed" },
          ],
          proposedChangeSurfaces: [
            { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
          ],
          confidence: "medium",
        },
        { requireSymbolEvidence: true },
      ),
    ).toBe(false);

    expect(
      isThoroughPlanDiscoveryEvidenceSufficient(
        {
          filesRead: [
            {
              path: "a.ts",
              reason: "seed",
              symbols: ["Foo"],
            },
            { path: "b.ts", reason: "seed" },
          ],
          proposedChangeSurfaces: [
            { path: "a.ts", actionHint: "Change", riskLevel: "low", evidence: "read" },
          ],
          confidence: "medium",
        },
        { requireSymbolEvidence: true },
      ),
    ).toBe(true);
  });
});

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
