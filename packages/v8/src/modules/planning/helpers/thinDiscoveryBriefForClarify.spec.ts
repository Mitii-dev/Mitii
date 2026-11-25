import { describe, expect, it } from "vitest";

import { thinDiscoveryBriefForClarify } from "./thinDiscoveryBriefForClarify";

describe("thinDiscoveryBriefForClarify", () => {
  it("returns undefined when there is no brief", () => {
    expect(thinDiscoveryBriefForClarify(undefined)).toBeUndefined();
  });

  it("strips change surfaces and forces low confidence", () => {
    const thinned = thinDiscoveryBriefForClarify({
      schemaVersion: 1,
      objective: "Improve tests or architecture",
      filesRead: [
        { path: "docs/GRADING_AND_DRY_RUN.md", reason: "seed" },
      ],
      targets: [],
      proposedChangeSurfaces: [
        {
          path: "docs/GRADING_AND_DRY_RUN.md",
          actionHint: "Change",
          riskLevel: "low",
          evidence: "seed read",
        },
      ],
      discoveredConstraints: [],
      verificationHints: [],
      openQuestions: ["Architecture or test-case improvements?"],
      confidence: "medium",
    });

    expect(thinned?.confidence).toBe("low");
    expect(thinned?.proposedChangeSurfaces).toEqual([]);
    expect(thinned?.filesRead).toHaveLength(1);
    expect(thinned?.openQuestions[0]).toMatch(/Architecture or test-case/i);
    expect(
      thinned?.openQuestions.some((q) => /concrete files/i.test(q)),
    ).toBe(true);
  });
});
