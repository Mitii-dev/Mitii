import { describe, expect, it } from "vitest";

import { PLANNING_SCHEMA_VERSION, type PlanArtifact } from "../contracts";
import { compactPlan, serializePlanText } from "./CompactPlan";

function planWithTargets(): PlanArtifact {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: "Fix TS2322 in the auth module",
    assumptions: ["Existing login stays intact"],
    openQuestions: [],
    contextReviewed: [],
    constraints: ["Keep password login working"],
    dimensions: {
      scope: "package",
      risk: "medium",
      clarity: "clear",
      complexity: "moderate",
      changeImpact: ["code"],
    },
    phases: [
      {
        id: "phase-change",
        name: "Change",
        purpose: "Apply the type fix",
        steps: [
          {
            id: "step-fix",
            intent: "Fix TS2322 in Login.ts",
            targetRefs: ["src/auth/Login.ts", "src/auth/types.ts"],
            actionSummary: "Align the login payload type with the server contract",
            expectedOutcome: "TS2322 is gone",
            riskLevel: "low",
          },
        ],
        dependencies: [],
        successCriteria: ["Typecheck passes"],
      },
    ],
    risks: [{ id: "r1", summary: "Might break SSO", severity: "medium" }],
    alternatives: [
      {
        id: "a1",
        summary: "Rewrite the auth stack",
        tradeoff: "Too large",
      },
    ],
    verification: { checks: ["typecheck"], manualQa: [], commands: [] },
    rollback: "Revert the login type change",
    approvalRequired: false,
    processHintsApplied: [],
  };
}

describe("serializePlanText", () => {
  it("emits every step targetRef as a write line", () => {
    const text = serializePlanText(planWithTargets());
    expect(text).toContain("write: src/auth/Login.ts, src/auth/types.ts");
    expect(text).toContain("Fix TS2322 in Login.ts");
  });

  it("emits need and affected lines when present", () => {
    const plan = planWithTargets();
    plan.phases[0]!.steps[0] = {
      ...plan.phases[0]!.steps[0]!,
      mustRead: ["src/auth/session.ts"],
      affected: ["src/auth/LoginForm.tsx"],
    };
    const text = serializePlanText(plan);
    expect(text).toContain("need: src/auth/session.ts");
    expect(text).toContain("affected: src/auth/LoginForm.tsx");
  });
});

describe("compactPlan", () => {
  it("drops alternatives and rollback before truncating step intents", () => {
    const plan = planWithTargets();
    const full = serializePlanText(plan);
    const fullTokens = Math.ceil(full.length / 4);
    const result = compactPlan({
      plan,
      budgetTokens: Math.max(1, fullTokens - 20),
    });
    expect(result.compacted).toBe(true);
    expect(result.reasonCodes).toContain("plan_compacted");
    expect(result.plan.alternatives).toEqual([]);
    expect(result.plan.rollback).toBeUndefined();
    expect(result.plan.phases[0]?.steps[0]?.intent).toBe("Fix TS2322 in Login.ts");
    expect(serializePlanText(result.plan)).toContain(
      "write: src/auth/Login.ts, src/auth/types.ts",
    );
  });

  it("keeps diagnostic overflow batches instead of slicing them to eight", () => {
    const steps = Array.from({ length: 12 }, (_, index) => ({
      id: `step-fix-diagnostic-${index + 1}`,
      intent: `Fix TS2322 in file${index + 1}.ts (${index + 1}/12)`,
      targetRefs: [`src/file${index + 1}.ts`],
      actionSummary: "Address this batch of TS2322 diagnostics in a single batch (same root cause). Type 'number' is not assignable to type 'string'.",
      expectedOutcome: "TS2322 diagnostics are resolved or reduced without introducing new errors.",
      riskLevel: "low" as const,
    }));
    const plan: PlanArtifact = {
      ...planWithTargets(),
      alternatives: Array.from({ length: 6 }, (_, index) => ({
        id: `alt-${index}`,
        summary: "A much larger alternative that should be dropped during compaction",
        tradeoff: "Too expensive for the current window",
      })),
      phases: [
        {
          id: "phase-change",
          name: "Change",
          purpose: "Fix the class in mutation-sized batches",
          steps,
          dependencies: [],
          successCriteria: ["Typecheck passes"],
        },
      ],
    };
    const result = compactPlan({ plan, budgetTokens: 80 });
    expect(result.compacted).toBe(true);
    expect(result.plan.phases[0]?.steps).toHaveLength(12);
    expect(result.plan.phases[0]?.steps[11]?.id).toBe("step-fix-diagnostic-12");
  });
});
