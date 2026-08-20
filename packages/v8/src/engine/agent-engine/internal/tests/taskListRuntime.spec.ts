import { describe, expect, it } from "vitest";

import type { ModelMessage } from "../../../../modules/model-gateway";
import type { PlanArtifact } from "../../../../modules/planning";
import type { TaskList } from "../../../../modules/task-list";
import { WORKING_SET_MARKER } from "../../../../modules/task-list";
import { maybeAutoAdvanceTaskList, prepareRepairWorkingSet, upsertTrailingWorkingSet } from "../taskListRuntime";

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
});

describe("maybeAutoAdvanceTaskList", () => {
  it("refills overflow plan steps after completing a live batch", () => {
    const plan: PlanArtifact = {
      schemaVersion: 1,
      objective: "Fix TS2322",
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
          steps: Array.from({ length: 10 }, (_, index) => ({
            id: `step-fix-diagnostic-${index + 1}`,
            intent: `Fix TS2322 in file${index + 1}.ts`,
            targetRefs: [`src/file${index + 1}.ts`],
            actionSummary: "Fix the diagnostic",
            expectedOutcome: "Gone",
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
    const current: TaskList = {
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `step-fix-diagnostic-${index + 1}`,
        title: `Change: Fix TS2322 in file${index + 1}.ts`,
        status: index === 0 ? ("active" as const) : ("pending" as const),
        sourceRef: `step-fix-diagnostic-${index + 1}`,
        write: [`src/file${index + 1}.ts`],
      })),
    };

    const result = maybeAutoAdvanceTaskList({
      enabled: true,
      current,
      toolStatus: "succeeded",
      isMutatingTool: true,
      changedFiles: ["src/file1.ts"],
      plan,
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
    const plan: PlanArtifact = {
      schemaVersion: 1,
      objective: "Fix TS2322",
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
          steps: Array.from({ length: 10 }, (_, index) => ({
            id: `step-fix-diagnostic-${index + 1}`,
            intent: `Fix TS2322 in file${index + 1}.ts`,
            targetRefs: [`src/file${index + 1}.ts`],
            actionSummary: "Fix the diagnostic",
            expectedOutcome: "Gone",
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
});
