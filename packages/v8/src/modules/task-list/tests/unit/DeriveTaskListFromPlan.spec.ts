import { describe, expect, it } from "vitest";

import { PLANNING_SCHEMA_VERSION, type PlanArtifact } from "../../../planning";
import { DEFAULT_MAX_TASKS, TaskListPipeline } from "../../index";

function planWithSteps(stepCount: number): PlanArtifact {
  const phases = [];
  let remaining = stepCount;
  let phaseIndex = 0;
  while (remaining > 0) {
    const take = Math.min(remaining, 6);
    phases.push({
      id: `phase-${phaseIndex + 1}`,
      name: `Phase ${phaseIndex + 1}`,
      purpose: "Work",
      steps: Array.from({ length: take }, (_, index) => ({
        id: `step-${phaseIndex}-${index}`,
        intent: `Do step ${phaseIndex}-${index}`,
        targetRefs: [],
        actionSummary: `Action ${phaseIndex}-${index}`,
        expectedOutcome: "Done",
        riskLevel: "low" as const,
      })),
      dependencies: [],
      successCriteria: [],
    });
    remaining -= take;
    phaseIndex += 1;
  }
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: "Ship the feature safely",
    assumptions: [],
    openQuestions: [],
    contextReviewed: [],
    constraints: [],
    dimensions: {
      scope: "package",
      risk: "medium",
      clarity: "clear",
      complexity: "complex",
      changeImpact: ["code"],
    },
    phases,
    risks: [],
    alternatives: [],
    verification: { checks: [], manualQa: [], commands: [] },
    approvalRequired: false,
    processHintsApplied: [],
  };
}

describe("deriveTaskListFromPlan", () => {
  const pipeline = new TaskListPipeline();

  it("creates pending tasks from the first plan steps only", () => {
    const result = pipeline.deriveFromPlan(planWithSteps(24));
    expect(result.status).toBe("applied");
    expect(result.taskList?.items).toHaveLength(DEFAULT_MAX_TASKS);
    expect(result.taskList?.items.every((item) => item.status === "pending")).toBe(
      true,
    );
    expect(result.taskList?.source).toBe("plan");
    expect(result.reasonCodes).toContain("task_list_derived");
  });

  it("does not mark derived tasks done", () => {
    const result = pipeline.deriveFromPlan(planWithSteps(2));
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "pending",
      "pending",
    ]);
  });

  it("skips skill playbook bullets that are not executable work", () => {
    const plan = planWithSteps(1);
    plan.phases[0] = {
      ...plan.phases[0]!,
      name: "Verify",
      steps: [
        {
          id: "meta-1",
          intent: "You have a spec and need to break it into implementable units",
          targetRefs: [],
          actionSummary: "When to use this skill",
          expectedOutcome: "N/A",
          riskLevel: "low",
        },
        {
          id: "real-1",
          intent: "Run typecheck on the package",
          targetRefs: ["packages/mui-builder"],
          actionSummary: "pnpm --filter mui-builder typecheck",
          expectedOutcome: "No TS errors",
          riskLevel: "low",
        },
      ],
    };
    const result = pipeline.deriveFromPlan(plan);
    expect(result.taskList?.items.map((item) => item.title)).toEqual([
      "Verify: Run typecheck on the package",
    ]);
  });
});
