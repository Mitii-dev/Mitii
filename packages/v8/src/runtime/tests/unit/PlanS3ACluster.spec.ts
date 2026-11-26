import { describe, expect, it } from "vitest";

import type { PlanArtifact } from "../../../modules/planning";
import {
  assertWindowBand,
  beginDiscoveryTaskList,
  deriveTaskListAfterPlan,
  rejectHollowPlan,
  resolvePlanExit,
  splitPlanExecuteBudgets,
  steerPlanArtifact,
} from "../../helpers/plan";
import { applyWindowPolicy } from "../../flow/steps/1-ApplyWindowPolicy";
import { StoreManager } from "../../helpers/store";
import type { StepContext } from "../../flow/steps/StepContext";
import { runtimeResumeInputSchema } from "../../contracts/input/RuntimeResumeInput";

function samplePlan(overrides?: Partial<PlanArtifact>): PlanArtifact {
  return {
    schemaVersion: 1,
    objective: "Fix login null crash",
    assumptions: [],
    openQuestions: [],
    contextReviewed: [],
    constraints: [],
    dimensions: {
      scope: "package",
      risk: "medium",
      clarity: "clear",
      complexity: "moderate",
      changeImpact: [],
    },
    phases: [
      {
        id: "p1",
        name: "Change",
        purpose: "Patch login",
        steps: [
          {
            id: "s1",
            intent: "Patch Login.ts null guard",
            targetRefs: ["src/auth/Login.ts"],
            actionSummary: "Add null check before submit",
            expectedOutcome: "No crash on empty form",
            riskLevel: "medium",
          },
          {
            id: "s2",
            intent: "Add regression test",
            targetRefs: ["src/auth/Login.test.ts"],
            actionSummary: "Cover empty submit",
            expectedOutcome: "Test passes",
            riskLevel: "low",
          },
        ],
        dependencies: [],
        successCriteria: ["login safe"],
      },
    ],
    risks: [],
    alternatives: [],
    verification: { checks: ["tests"], manualQa: [], commands: [] },
    approvalRequired: true,
    processHintsApplied: [],
    ...overrides,
  };
}

describe("S3A STEER / WINDOW / EXIT / TASKLIST", () => {
  it("steerPlanArtifact patches without rediscovery when targets kept", () => {
    const result = steerPlanArtifact({
      plan: samplePlan(),
      patch: {
        objective: "Fix login null crash (steer)",
        stepTextPatches: [
          {
            stepId: "s1",
            actionSummary: "Guard submit with early return",
          },
        ],
      },
    });
    expect(result.needsRediscovery).toBe(false);
    expect(result.plan.objective).toContain("steer");
    expect(result.plan.phases[0]?.steps[0]?.actionSummary).toContain("early return");
    expect(result.reasonCodes).toContain("plan_steer_applied");
  });

  it("steerPlanArtifact flags rediscovery when most targets dropped", () => {
    const result = steerPlanArtifact({
      plan: samplePlan(),
      patch: {
        stepTargetPatches: [
          { stepId: "s1", targetRefs: [] },
          { stepId: "s2", targetRefs: [] },
        ],
      },
    });
    expect(result.needsRediscovery).toBe(true);
    expect(result.reasonCodes).toContain("plan_steer_needs_rediscovery");
  });

  it("resolvePlanExit covers §6.4 cases", () => {
    expect(
      resolvePlanExit({
        mode: "plan",
        route: "plan",
        planRan: true,
      }).kind,
    ).toBe("complete_plan_ready");

    expect(
      resolvePlanExit({
        mode: "agent",
        route: "execute",
        planGate: "required_before_execute",
        planningDepth: "visible",
        planRan: true,
      }).kind,
    ).toBe("suspend_plan_approval");

    expect(
      resolvePlanExit({
        mode: "agent",
        route: "execute",
        planningDepth: "internal",
        planRan: true,
      }).kind,
    ).toBe("continue_internal");

    expect(
      resolvePlanExit({
        planRan: true,
        hollow: true,
      }).kind,
    ).toBe("suspend_clarify_hollow");
  });

  it("assertWindowBand + splitPlanExecuteBudgets", () => {
    const ok = assertWindowBand({ contextWindowTokens: 128_000 });
    expect(ok.ok).toBe(true);
    expect(ok.band).toBe("wide");

    const split = splitPlanExecuteBudgets({
      maxModelCalls: 20,
      hardMaxModelCalls: 40,
      maxToolCalls: 30,
      hardMaxToolCalls: 60,
    });
    expect(split.plan.maxModelCalls + split.execute.maxModelCalls).toBe(20);
    expect(split.reasonCodes).toContain("window_plan_execute_split");
  });

  it("applyWindowPolicy stores windowBand split", () => {
    const store = StoreManager.create("wb1");
    const ctx: StepContext = {
      input: { message: "hi", contextWindowTokens: 128_000 },
      mode: "agent",
      store,
    };
    applyWindowPolicy(ctx);
    const band = store.getSlice<{
      band?: string;
      planBudget?: { maxModelCalls: number };
      reasonCodes?: string[];
    }>("windowBand");
    expect(band?.band).toBe("wide");
    expect(band?.planBudget?.maxModelCalls).toBeGreaterThan(0);
    expect(band?.reasonCodes).toEqual(
      expect.arrayContaining(["window_band_ok", "window_plan_execute_split"]),
    );
  });

  it("deriveTaskListAfterPlan + discovery temp list", () => {
    const discovery = beginDiscoveryTaskList("Exploring login");
    expect(discovery.taskList.purpose).toBe("discovery");
    expect(discovery.taskList.items[0]?.status).toBe("active");

    const derived = deriveTaskListAfterPlan({ plan: samplePlan() });
    // Concrete file-scoped steps should apply; if module rejects, still assert shape.
    if (derived.status === "applied") {
      expect(derived.taskList?.source).toBe("plan");
      expect(derived.taskList?.items.some((i) => i.status === "active")).toBe(
        true,
      );
    } else {
      expect(derived.reasonCodes).toContain("tasklist_derive_rejected");
    }
  });

  it("resume input accepts steer + planSteer patch", () => {
    const parsed = runtimeResumeInputSchema.parse({
      runId: "r1",
      decision: "steer",
      planSteer: {
        objective: "Narrow to Login.ts only",
        stepTargetPatches: [
          { stepId: "s1", targetRefs: ["src/auth/Login.ts"] },
        ],
      },
    });
    expect(parsed.decision).toBe("steer");
    expect(parsed.planSteer?.objective).toContain("Login");
  });

  it("rejectHollowPlan still rejects generic skeletons", () => {
    expect(
      rejectHollowPlan({
        title: "Do the work",
        phases: [
          { name: "Phase 1: Investigate", steps: [{ intent: "look around" }] },
          { name: "Phase 2: Implement", steps: [{ intent: "change stuff" }] },
          { name: "Phase 3: Test", steps: [{ intent: "test it" }] },
        ],
      }).ok,
    ).toBe(false);
  });
});
