import { describe, expect, it } from "vitest";

import { applyPlanScopePhaseBounds } from "../../helpers/plan-discovery/ApplyPlanScopePhaseBounds";
import type { PlanningParsedInput } from "../../../modules/planning";

function baseInput(): PlanningParsedInput {
  return {
    schemaVersion: 1,
    query: "Improve tests",
    evidence: {
      schemaVersion: 1,
      clarity: "clear",
      taskSize: "medium",
      complexity: "moderate",
      scope: "package",
      risk: "medium",
      recommendsPlanning: true,
      recommendsRepositoryDiscovery: true,
      targets: [],
      requestedOutcomes: [],
    },
    planningDepth: "standard",
    processHints: [],
  } as PlanningParsedInput;
}

describe("applyPlanScopePhaseBounds", () => {
  it("bounds paths and stages next-phase offer for multi-outcome scope A", () => {
    const reasonCodes: string[] = [];
    const planningInput = {
      ...baseInput(),
      query:
        "How I can improve the test cases? Can you plan or changing the architecture?",
      evidence: {
        ...baseInput().evidence,
        clarity: "unclear",
        primaryIntent: "refactor",
      },
    };
    const result = applyPlanScopePhaseBounds({
      planningInput,
      knownPathHints: [
        "cases/auth/oracle.test.ts",
        "packages/runner/src/score.ts",
        ".github/workflows/ci.yml",
      ],
      scopeChoice: { optionId: "outcome:scope-a-focused" },
      taskSize: "medium",
      contextWindowTokens: 80_000,
      reasonCodes: reasonCodes as never[],
    });
    expect(result.resolvedScopeId).toBe("a");
    expect(result.discoveryPreferredPaths).toEqual([
      "cases/auth/oracle.test.ts",
    ]);
    expect(result.discoveryBudgetOverride).toBeDefined();
    expect(result.discoveryScopeHint).toMatch(/Scope lock/);
    expect(result.nextPlanPhaseOffer).toContain("## Next phase available");
    expect(reasonCodes).toContain("plan_scope_bounds_applied");
    expect(result.planningInput.processHints?.[0]).toMatch(/Scope lock A/);
  });

  it("bounds paths but skips campaign offer for clear single-outcome asks", () => {
    const reasonCodes: string[] = [];
    const planningInput = {
      ...baseInput(),
      query: "Build Run Profiles and npm run test:profile",
      evidence: {
        ...baseInput().evidence,
        clarity: "clear",
        primaryIntent: "feature",
        requestedOutcomes: ["Ship run profiles CLI"],
      },
    };
    const result = applyPlanScopePhaseBounds({
      planningInput,
      knownPathHints: ["wdio.desktop.conf.ts", "package.json"],
      scopeChoice: { optionId: "outcome:scope-c-architecture" },
      taskSize: "large",
      contextWindowTokens: 80_000,
      reasonCodes: reasonCodes as never[],
    });
    expect(result.resolvedScopeId).toBe("c");
    expect(result.nextPlanPhaseOffer).toBeUndefined();
  });

  it("is a no-op when scope is unresolved", () => {
    const reasonCodes: string[] = [];
    const result = applyPlanScopePhaseBounds({
      planningInput: baseInput(),
      knownPathHints: ["a.ts"],
      scopeChoice: { query: "vague ask" },
      reasonCodes: reasonCodes as never[],
    });
    expect(result.resolvedScopeId).toBeUndefined();
    expect(result.discoveryPreferredPaths).toEqual(["a.ts"]);
    expect(result.nextPlanPhaseOffer).toBeUndefined();
    expect(reasonCodes).not.toContain("plan_scope_bounds_applied");
  });
});
