import { describe, expect, it } from "vitest";

import { PLANNING_SCHEMA_VERSION, type PlanArtifact } from "../../../planning";
import { DEFAULT_MAX_TASKS, TaskListPipeline } from "../../index";

function planWithSteps(stepCount: number): PlanArtifact {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: "Fix TS2322 across the package",
    assumptions: [],
    openQuestions: [],
    contextReviewed: [],
    constraints: [],
    dimensions: {
      scope: "package",
      risk: "low",
      clarity: "clear",
      complexity: "moderate",
      changeImpact: ["code"],
    },
    phases: [
      {
        id: "phase-change",
        name: "Change",
        purpose: "Fix the class in batches",
        steps: Array.from({ length: stepCount }, (_, index) => ({
          id: `step-fix-diagnostic-${index + 1}`,
          intent: `Fix TS2322 in file${index + 1}.ts`,
          targetRefs: [`src/file${index + 1}.ts`],
          actionSummary: `Address the reported TS2322 diagnostic in src/file${index + 1}.ts.`,
          expectedOutcome: "TS2322 is gone",
          riskLevel: "low" as const,
        })),
        dependencies: [],
        successCriteria: [],
      },
    ],
    risks: [],
    alternatives: [],
    verification: { checks: [], manualQa: [], commands: [] },
    approvalRequired: false,
    processHintsApplied: [],
  };
}

describe("refillTaskListFromPlan", () => {
  const pipeline = new TaskListPipeline();

  it("streams the next unused plan step after a live item completes", () => {
    const plan = planWithSteps(10);
    const derived = pipeline.deriveFromPlan(plan);
    expect(derived.taskList?.items).toHaveLength(DEFAULT_MAX_TASKS);
    const live = {
      ...derived.taskList!,
      items: derived.taskList!.items.map((item, index) =>
        index === 0 ? { ...item, status: "done" as const } : item,
      ),
    };

    const refilled = pipeline.refillFromPlan(live, plan);
    expect(refilled.reasonCodes).toContain("task_list_refilled");
    expect(refilled.taskList?.items).toHaveLength(DEFAULT_MAX_TASKS);
    expect(
      refilled.taskList?.items.some((item) => item.id === "step-fix-diagnostic-1"),
    ).toBe(false);
    expect(
      refilled.taskList?.items.map((item) => item.sourceRef),
    ).toContain("step-fix-diagnostic-9");
    expect(
      refilled.taskList?.items.filter((item) => item.status === "active"),
    ).toHaveLength(1);
  });

  it("does not add overflow while the live list is full of unfinished work", () => {
    const plan = planWithSteps(10);
    const derived = pipeline.deriveFromPlan(plan);
    const refilled = pipeline.refillFromPlan(derived.taskList!, plan);
    expect(refilled.reasonCodes).toContain("task_list_unchanged");
    expect(refilled.taskList?.items.map((item) => item.id)).toEqual(
      derived.taskList?.items.map((item) => item.id),
    );
  });
});
