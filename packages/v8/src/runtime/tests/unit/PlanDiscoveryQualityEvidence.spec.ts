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

