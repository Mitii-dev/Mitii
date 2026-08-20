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
        targetRefs: [`src/feature/step-${phaseIndex}-${index}.ts`],
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

  it("respects a window-scaled live task cap above the default", () => {
    const result = pipeline.deriveFromPlan(planWithSteps(24), 12);
    expect(result.taskList?.items).toHaveLength(12);
  });

  it("activates the first derived task and leaves the rest pending", () => {
    const result = pipeline.deriveFromPlan(planWithSteps(24));
    expect(result.status).toBe("applied");
    expect(result.taskList?.items).toHaveLength(DEFAULT_MAX_TASKS);
    expect(result.taskList?.items[0]?.status).toBe("active");
    expect(
      result.taskList?.items.slice(1).every((item) => item.status === "pending"),
    ).toBe(true);
    expect(result.taskList?.source).toBe("plan");
    expect(result.taskList?.purpose).toBe("execution");
    expect(result.reasonCodes).toContain("task_list_derived");
  });

  it("does not mark derived tasks done", () => {
    const result = pipeline.deriveFromPlan(planWithSteps(2));
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "active",
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
          id: "meta-2",
          intent: "Restate the goal and constraints from the spec",
          targetRefs: [],
          actionSummary: "Task-breakdown methodology",
          expectedOutcome: "N/A",
          riskLevel: "low",
        },
        {
          id: "meta-3",
          intent: "Produce ordered tasks with acceptance criteria",
          targetRefs: [],
          actionSummary: "Task-breakdown methodology",
          expectedOutcome: "N/A",
          riskLevel: "low",
        },
        {
          id: "real-1",
          intent: "Run typecheck on the package",
          targetRefs: ["packages/mui-builder/src/index.ts"],
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
    expect(result.taskList?.items[0]?.status).toBe("active");
  });

  it("leaves the list empty for package-wide mega-objectives without a file", () => {
    const plan = planWithSteps(1);
    plan.objective = "Resolve all TypeScript compilation/type errors in the target package";
    plan.phases = [
      {
        id: "phase-change",
        name: "Change",
        purpose: "Fix",
        steps: [
          {
            id: "step-implement",
            intent: "Resolve all TypeScript compilation/type errors in the target package",
            targetRefs: ["packages/mui-builder"],
            actionSummary: "Fix package errors",
            expectedOutcome: "Typecheck green",
            riskLevel: "medium",
          },
        ],
        dependencies: [],
        successCriteria: [],
      },
      {
        id: "phase-verify",
        name: "Verify",
        purpose: "Check",
        steps: [
          {
            id: "step-verify",
            intent: "Verify the fix in packages/mui-builder",
            targetRefs: ["packages/mui-builder"],
            actionSummary: "Run typecheck",
            expectedOutcome: "Green",
            riskLevel: "low",
          },
        ],
        dependencies: [],
        successCriteria: [],
      },
    ];
    const result = pipeline.deriveFromPlan(plan);
    expect(result.status).toBe("rejected");
    expect(result.taskList).toBeUndefined();
    expect(result.reasonCodes).toContain("task_list_empty");
  });

  it("keeps only preferred work phases when Change/Verify exist (no deferred Discover append)", () => {
    const plan = planWithSteps(1);
    plan.phases = [
      {
        id: "phase-discover",
        name: "Discover",
        purpose: "Inspect",
        steps: [
          {
            id: "discover-behavior",
            intent: "Inspect current behavior",
            targetRefs: ["src/widget.ts"],
            actionSummary: "Read the current behavior",
            expectedOutcome: "Behavior understood",
            riskLevel: "low",
          },
        ],
        dependencies: [],
        successCriteria: [],
      },
      {
        id: "phase-change",
        name: "Change",
        purpose: "Modify",
        steps: [
          {
            id: "change-widget",
            intent: "Update widget behavior",
            targetRefs: ["src/widget.ts"],
            actionSummary: "Change the widget implementation",
            expectedOutcome: "Widget matches requested behavior",
            riskLevel: "medium",
          },
        ],
        dependencies: [],
        successCriteria: [],
      },
      {
        id: "phase-verify",
        name: "Verify",
        purpose: "Check",
        steps: [
          {
            id: "verify-widget",
            intent: "Verify widget behavior",
            targetRefs: ["src/widget.test.ts"],
            actionSummary: "Run the focused test",
            expectedOutcome: "Widget behavior is covered",
            riskLevel: "low",
          },
        ],
        dependencies: [],
        successCriteria: [],
      },
    ];

    const result = pipeline.deriveFromPlan(plan);
    expect(result.taskList?.items.map((item) => item.title)).toEqual([
      "Change: Update widget behavior",
      "Verify: Verify widget behavior",
    ]);
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "active",
      "pending",
    ]);
    expect(result.taskList?.items[0]?.detail).toContain("Scope: src/widget.ts");
    expect(result.taskList?.items[0]?.sourceRef).toBe("change-widget");
    expect(result.taskList?.items[0]?.write).toEqual(["src/widget.ts"]);
  });

  it("copies every plan step targetRef onto the derived write list", () => {
    const plan = planWithSteps(1);
    plan.phases[0] = {
      ...plan.phases[0]!,
      name: "Change",
      steps: [
        {
          id: "fix-login",
          intent: "Fix TS2322 in Login.ts",
          targetRefs: ["src/auth/Login.ts", "src/auth/types.ts", "src/auth/Login.ts"],
          actionSummary: "Align the login payload type",
          expectedOutcome: "TS2322 is gone",
          riskLevel: "low",
        },
      ],
    };
    const result = pipeline.deriveFromPlan(plan);
    expect(result.taskList?.items[0]?.write).toEqual([
      "src/auth/Login.ts",
      "src/auth/types.ts",
    ]);
    expect(result.taskList?.items[0]?.detail).toContain(
      "Scope: src/auth/Login.ts, src/auth/types.ts",
    );
  });

  it("copies plan step mustRead and affected onto the derived task item", () => {
    const plan = planWithSteps(1);
    plan.phases[0] = {
      ...plan.phases[0]!,
      name: "Change",
      steps: [
        {
          id: "fix-login",
          intent: "Fix TS2322 in Login.ts",
          targetRefs: ["src/auth/Login.ts"],
          mustRead: ["src/auth/types.ts", "src/auth/Login.ts"],
          affected: ["src/auth/LoginForm.tsx"],
          actionSummary: "Align the login payload type",
          expectedOutcome: "TS2322 is gone",
          riskLevel: "low",
        },
      ],
    };
    const result = pipeline.deriveFromPlan(plan);
    expect(result.taskList?.items[0]?.write).toEqual(["src/auth/Login.ts"]);
    expect(result.taskList?.items[0]?.mustRead).toEqual(["src/auth/types.ts"]);
    expect(result.taskList?.items[0]?.affected).toEqual([
      "src/auth/LoginForm.tsx",
    ]);
  });

  it("falls back to deferred discovery when no preferred work exists", () => {
    const plan = planWithSteps(1);
    plan.phases[0] = {
      ...plan.phases[0]!,
      name: "Discover",
      steps: [
        {
          id: "discover-only",
          intent: "Inspect failure evidence",
          targetRefs: ["src/failure.log"],
          actionSummary: "Read the failure evidence",
          expectedOutcome: "Failure evidence is known",
          riskLevel: "low",
        },
      ],
    };

    const result = pipeline.deriveFromPlan(plan);
    expect(result.status).toBe("applied");
    expect(result.taskList?.items.map((item) => item.title)).toEqual([
      "Discover: Inspect failure evidence",
    ]);
    expect(result.taskList?.items[0]?.status).toBe("active");
  });
});
