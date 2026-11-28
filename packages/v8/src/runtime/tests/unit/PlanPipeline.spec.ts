import { describe, expect, it } from "vitest";

import { runThroughPlanPipeline } from "../../flow/RunThroughPlanPipeline";
import { shouldRunPlanPipeline } from "../../helpers/plan";
import { rejectHollowPlan } from "../../helpers/plan";

describe("shouldRunPlanPipeline (§6.1)", () => {
  it("runs for plan route and execute+visible/internal only", () => {
    expect(
      shouldRunPlanPipeline({ route: "plan", planningDepth: "visible" }),
    ).toBe(true);
    expect(
      shouldRunPlanPipeline({ route: "execute", planningDepth: "visible" }),
    ).toBe(true);
    expect(
      shouldRunPlanPipeline({ route: "execute", planningDepth: "internal" }),
    ).toBe(true);
    expect(
      shouldRunPlanPipeline({ route: "execute", planningDepth: "none" }),
    ).toBe(false);
    expect(
      shouldRunPlanPipeline({ route: "diagnose", planningDepth: "visible" }),
    ).toBe(false);
    expect(
      shouldRunPlanPipeline({ route: "answer", planningDepth: "none" }),
    ).toBe(false);
  });
});

describe("rejectHollowPlan", () => {
  it("rejects empty and generic three-phase skeletons", () => {
    expect(rejectHollowPlan({ phases: [] }).ok).toBe(false);
    expect(
      rejectHollowPlan({
        phases: [
          { name: "Investigate", steps: [{}] },
          { name: "Implement", steps: [{}] },
          { name: "Test", steps: [{}] },
        ],
      }).ok,
    ).toBe(false);
    expect(
      rejectHollowPlan({
        phases: [
          {
            name: "Modify auth login",
            steps: [{}, {}, {}, {}],
          },
        ],
      }).ok,
    ).toBe(true);
  });
});

describe("runThroughPlanPipeline", () => {
  it("skips plan when clarify suspends early", async () => {
    const result = await runThroughPlanPipeline({
      start: { message: "fix it" },
      mode: "agent",
      runId: "p3-clarify",
    });
    expect(result.gate?.status).toBe("suspended");
    expect(result.planPipeline.ran).toBe(false);
  });

  it("pins monotonic discovery envelope on plan mode", async () => {
    const compact = await runThroughPlanPipeline({
      start: {
        message: "plan a refactor of packages/v8/src/runtime helpers",
        contextWindowTokens: 40_000,
      },
      mode: "plan",
      runId: "p3-compact",
    });
    const wide = await runThroughPlanPipeline({
      start: {
        message: "plan a refactor of packages/v8/src/runtime helpers",
        contextWindowTokens: 150_000,
      },
      mode: "plan",
      runId: "p3-wide",
    });
    expect(compact.planPipeline.ran).toBe(true);
    expect(wide.planPipeline.ran).toBe(true);
    expect(wide.planPipeline.discoveryBudget!.maxFileReads).toBeGreaterThanOrEqual(
      compact.planPipeline.discoveryBudget!.maxFileReads,
    );
    expect(wide.planPipeline.discoveryBudget!.maxModelTurns).toBeGreaterThanOrEqual(
      compact.planPipeline.discoveryBudget!.maxModelTurns,
    );
  });
});
