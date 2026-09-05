import { describe, expect, it } from "vitest";

import type { ModelMessage } from "../../../../modules/model-gateway";
import type { PlanArtifact } from "../../../../modules/planning";
import type { TaskList } from "../../../../modules/task-list";
import { WORKING_SET_MARKER } from "../../../../modules/task-list";
import {
  completePlanStepsFromDiagnostics,
  maybeAutoAdvanceTaskList,
  prepareRepairWorkingSet,
  upsertTrailingWorkingSet,
  type TaskListRef,
} from "../taskListRuntime";

function planWithSteps(stepCount: number, titlePrefix = "Update"): PlanArtifact {
  return {
    schemaVersion: 1,
    objective: "Update files",
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
        purpose: "Fix batches",
        steps: Array.from({ length: stepCount }, (_, index) => ({
          id: `step-fix-diagnostic-${index + 1}`,
          intent: `${titlePrefix} file${index + 1}.ts`,
          targetRefs: [`src/file${index + 1}.ts`],
          actionSummary: "Apply the change",
          expectedOutcome: "Done",
          riskLevel: "low",
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

describe("upsertTrailingWorkingSet", () => {
  it("pins a live table at the end and replaces it on later updates", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "fix it" },
    ];
    const first: TaskList = {
      schemaVersion: 1,
      source: "plan",
      items: [
        {
          id: "a",
          title: "Fix Login.ts",
          status: "active",
          write: ["src/auth/Login.ts"],
        },
      ],
    };
    upsertTrailingWorkingSet(messages, { taskList: first });
    expect(messages.at(-1)?.content).toContain(WORKING_SET_MARKER);
    expect(messages.at(-1)?.content).toContain("src/auth/Login.ts");
    expect(messages.filter((message) => message.content.includes(WORKING_SET_MARKER))).toHaveLength(1);

    const next: TaskList = {
      ...first,
      items: [
        { ...first.items[0]!, status: "done" },
        {
          id: "b",
          title: "Fix types.ts",
          status: "active",
          write: ["src/auth/types.ts"],
        },
      ],
    };
    upsertTrailingWorkingSet(messages, { taskList: next });
    expect(messages.filter((message) => message.content.includes(WORKING_SET_MARKER))).toHaveLength(1);
    expect(messages.at(-1)?.content).toContain("src/auth/types.ts");
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("always upserts a minimal working set when no task list exists", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "assistant", content: "working" },
      { role: "tool", toolCallId: "t1", content: "{}" },
    ];
    upsertTrailingWorkingSet(messages, {});
    expect(messages.at(-1)?.role).toBe("user");
    expect(messages.at(-1)?.content).toContain(WORKING_SET_MARKER);
    expect(messages.at(-1)?.content).toContain("No live checklist yet");
  });

  it("re-upserts working set after it was dropped from the transcript", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "implement package" },
    ];
    upsertTrailingWorkingSet(messages, {
      establishedFacts: [
        { id: "read_file:src/a.ts", content: "src/a.ts => export const a" },
      ],
    });
    // Simulate hard compaction dropping the trailing block.
    messages.splice(
      messages.findIndex((m) => m.content.includes(WORKING_SET_MARKER)),
      1,
    );
    expect(
      messages.some((m) => m.content.includes(WORKING_SET_MARKER)),
    ).toBe(false);

    upsertTrailingWorkingSet(messages, {
      establishedFacts: [
        { id: "read_file:src/a.ts", content: "src/a.ts => export const a" },
      ],
    });
    expect(messages.at(-1)?.content).toContain(WORKING_SET_MARKER);
    expect(messages.at(-1)?.content).toContain("Established observations");
  });
});

describe("maybeAutoAdvanceTaskList", () => {
  it("refills overflow plan steps after completing a live batch", () => {
    const plan = planWithSteps(10);
    const current: TaskList = {
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `step-fix-diagnostic-${index + 1}`,
        title: `Update file${index + 1}.ts`,
        status: index === 0 ? ("active" as const) : ("pending" as const),
        sourceRef: `step-fix-diagnostic-${index + 1}`,
        write: [`src/file${index + 1}.ts`],
      })),
    };
    const taskListRef: TaskListRef = { current, completedPlanStepIds: [] };

    const result = maybeAutoAdvanceTaskList({
      enabled: true,
      current,
      toolStatus: "succeeded",
      isMutatingTool: true,
      changedFiles: ["src/file1.ts"],
      plan,
      taskListRef,
    });

    expect(result.advanced).toBe(true);
    expect(result.refilled).toBe(true);
    expect(result.taskList?.items).toHaveLength(8);
    expect(
      result.taskList?.items.some((item) => item.id === "step-fix-diagnostic-1"),
    ).toBe(false);
    expect(
      result.taskList?.items.map((item) => item.sourceRef),
    ).toContain("step-fix-diagnostic-9");
    expect(taskListRef.completedPlanStepIds).toContain("step-fix-diagnostic-1");
  });

  it("matches package-prefixed mutation paths to shorter write hints", () => {
    const current: TaskList = {
      schemaVersion: 1,
      source: "agent",
      items: [
        {
          id: "a",
          title: "Update Button",
          status: "active",
          write: ["src/Button.tsx"],
        },
        {
          id: "b",
          title: "Update Form",
          status: "pending",
          write: ["src/Form.tsx"],
        },
      ],
    };

    const result = maybeAutoAdvanceTaskList({
      enabled: true,
      current,
      toolStatus: "succeeded",
      isMutatingTool: true,
      changedFiles: ["packages/mui-builder/src/Button.tsx"],
    });

    expect(result.advanced).toBe(true);
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "active",
    ]);
  });

  it("does not invent completion when changedFiles are empty", () => {
    const current: TaskList = {
      schemaVersion: 1,
      source: "agent",
      items: [
        {
          id: "a",
          title: "Update src/a.ts",
          status: "active",
          write: ["src/a.ts"],
        },
      ],
    };

    const result = maybeAutoAdvanceTaskList({
      enabled: true,
      current,
      toolStatus: "succeeded",
      isMutatingTool: true,
      changedFiles: [],
    });

    expect(result.advanced).toBe(false);
    expect(result.taskList).toBeUndefined();
  });

  it("skips diagnostic-coded Change rows until verification clears them", () => {
    const current: TaskList = {
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: [
        {
          id: "step-1",
          title: "Change: Fix TS2339 in src/a.ts",
          status: "active",
          write: ["src/a.ts"],
          sourceRef: "step-1",
        },
      ],
    };

    const result = maybeAutoAdvanceTaskList({
      enabled: true,
      current,
      toolStatus: "succeeded",
      isMutatingTool: true,
      changedFiles: ["src/a.ts"],
    });

    expect(result.advanced).toBe(false);
  });
});

describe("completePlanStepsFromDiagnostics", () => {
  it("completes diagnostic batches when the error class is gone on owned paths", () => {
    const current: TaskList = {
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: [
        {
          id: "step-1",
          title: "Change: Fix TS2339 in src/a.ts",
          status: "active",
          write: ["src/a.ts"],
          sourceRef: "step-1",
        },
        {
          id: "step-2",
          title: "Change: Fix TS2339 in src/b.ts",
          status: "pending",
          write: ["src/b.ts"],
          sourceRef: "step-2",
        },
      ],
    };
    const taskListRef: TaskListRef = { current, completedPlanStepIds: [] };

    const result = completePlanStepsFromDiagnostics({
      current,
      taskListRef,
      diagnostics: [
        {
          severity: "error",
          code: "TS2339",
          message: "still failing",
          path: "src/b.ts",
        },
      ],
    });

    expect(result.advanced).toBe(true);
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "active",
    ]);
    expect(taskListRef.completedPlanStepIds).toEqual(["step-1"]);
  });

  it("does not complete when new errors were introduced", () => {
    const current: TaskList = {
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: [
        {
          id: "step-1",
          title: "Change: Fix TS2339 in src/a.ts",
          status: "active",
          write: ["src/a.ts"],
          sourceRef: "step-1",
        },
      ],
    };
    const taskListRef: TaskListRef = { current, completedPlanStepIds: [] };

    const result = completePlanStepsFromDiagnostics({
      current,
      taskListRef,
      diagnostics: [],
      newErrorsIntroduced: true,
    });

    expect(result.advanced).toBe(false);
    expect(taskListRef.completedPlanStepIds).toEqual([]);
  });
});

describe("prepareRepairWorkingSet", () => {
  it("activates the next pending batch when the current active row is done", () => {
    const current: TaskList = {
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: [
        {
          id: "step-fix-diagnostic-1",
          title: "Change: Fix TS2322 in src/a.ts",
          status: "done",
          write: ["src/a.ts"],
          sourceRef: "step-fix-diagnostic-1",
        },
        {
          id: "step-fix-diagnostic-2",
          title: "Change: Fix TS2322 in src/b.ts",
          status: "pending",
          write: ["src/b.ts"],
          sourceRef: "step-fix-diagnostic-2",
        },
      ],
    };

    const result = prepareRepairWorkingSet({ current });
    expect(result.activated).toBe(true);
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "active",
    ]);
    expect(result.activeItem?.id).toBe("step-fix-diagnostic-2");
  });

  it("refills overflow plan batches when the live list is all terminal", () => {
    const plan = planWithSteps(10, "Fix TS2322 in");
    const current: TaskList = {
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `step-fix-diagnostic-${index + 1}`,
        title: `Change: Fix TS2322 in file${index + 1}.ts`,
        status: "done" as const,
        write: [`src/file${index + 1}.ts`],
        sourceRef: `step-fix-diagnostic-${index + 1}`,
      })),
    };

    const result = prepareRepairWorkingSet({ current, plan });
    expect(result.refilled).toBe(true);
    expect(result.activeItem?.sourceRef).toBe("step-fix-diagnostic-9");
    expect(
      result.taskList?.items.find((item) => item.status === "active")?.sourceRef,
    ).toBe("step-fix-diagnostic-9");
    expect(
      result.taskList?.items.map((item) => item.sourceRef),
    ).toContain("step-fix-diagnostic-9");
  });

  it("never re-adds notebook-completed plan steps on refill", () => {
    const plan = planWithSteps(10);
    const current: TaskList = {
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `step-fix-diagnostic-${index + 1}`,
        title: `Update file${index + 1}.ts`,
        status: "done" as const,
        write: [`src/file${index + 1}.ts`],
        sourceRef: `step-fix-diagnostic-${index + 1}`,
      })),
    };

    const result = prepareRepairWorkingSet({
      current,
      plan,
      completedPlanStepIds: [
        ...Array.from({ length: 8 }, (_, index) => `step-fix-diagnostic-${index + 1}`),
        "step-fix-diagnostic-9",
      ],
    });

    expect(result.refilled).toBe(true);
    expect(
      result.taskList?.items.map((item) => item.sourceRef),
    ).not.toContain("step-fix-diagnostic-9");
    expect(result.activeItem?.sourceRef).toBe("step-fix-diagnostic-10");
  });
});
