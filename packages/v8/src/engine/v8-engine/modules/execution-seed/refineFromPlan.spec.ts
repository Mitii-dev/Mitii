import { describe, expect, it } from "vitest";

import { refineExecutionSeedFromPlan } from "./refineFromPlan";
import type { PlanArtifact } from "../../../../modules/planning";

function planWithTargets(refs: string[]): PlanArtifact {
  return {
    schemaVersion: 1,
    objective: "Build Run Profiles",
    assumptions: [],
    openQuestions: [],
    contextReviewed: [],
    constraints: [],
    dimensions: {
      scope: "repository",
      risk: "medium",
      clarity: "clear",
      complexity: "moderate",
      changeImpact: ["code"],
    },
    phases: [
      {
        id: "change",
        name: "Change",
        purpose: "Implement profiles",
        successCriteria: [],
        steps: [
          {
            id: "step-1",
            intent: "Add profile config",
            actionSummary: "Create profiles.ts",
            targetRefs: refs,
            expectedOutcome: "profiles exist",
          },
        ],
      },
    ],
    risks: [],
    verification: { checks: [], manualQa: [] },
    alternatives: [],
    approvalRequired: true,
  } as PlanArtifact;
}

describe("refineExecutionSeedFromPlan", () => {
  it("promotes Change targetRefs to a trusted seed", () => {
    const seed = refineExecutionSeedFromPlan({
      seed: {
        paths: [],
        symbols: [],
        causeNotes: [],
        confidence: "weak",
        source: "none",
      },
      plan: planWithTargets([
        "test/shared/config/profiles.ts",
        "scripts/runProfile.ts",
        "package.json",
      ]),
    });
    expect(seed.confidence).toBe("trusted");
    expect(seed.paths).toEqual(
      expect.arrayContaining([
        "test/shared/config/profiles.ts",
        "scripts/runProfile.ts",
        "package.json",
      ]),
    );
  });

  it("drops noise paths like .mitii and .gitignore", () => {
    const seed = refineExecutionSeedFromPlan({
      seed: undefined,
      plan: planWithTargets([".mitii", ".gitignore", "wdio.desktop.conf.ts"]),
    });
    expect(seed.confidence).toBe("trusted");
    expect(seed.paths).toEqual(["wdio.desktop.conf.ts"]);
  });

  it("keeps weak seed when plan has no editable surfaces", () => {
    const seed = refineExecutionSeedFromPlan({
      seed: {
        paths: [],
        symbols: [],
        causeNotes: [],
        confidence: "weak",
        source: "none",
      },
      plan: planWithTargets([".mitii", ".gitignore"]),
    });
    expect(seed.confidence).toBe("weak");
    expect(seed.paths).toEqual([]);
  });
});
