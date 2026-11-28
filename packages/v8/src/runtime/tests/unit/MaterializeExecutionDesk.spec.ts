import { describe, expect, it } from "vitest";

import {
  materializeExecutionDesk,
  reconcileExecutionDeskOnFinish,
} from "../../helpers/plan";
import { TASK_LIST_SCHEMA_VERSION } from "../../../modules/task-list";

describe("materializeExecutionDesk", () => {
  it("keeps a sealed non-weak execution desk", () => {
    const current = {
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "plan" as const,
      purpose: "execution" as const,
      items: [
        { id: "s1", title: "Desugar nested http.start", status: "active" as const },
        { id: "s2", title: "Add compile tests", status: "pending" as const },
      ],
    };
    const result = materializeExecutionDesk({ current });
    expect(result.status).toBe("skipped");
    expect(result.taskList).toEqual(current);
    expect(result.reasonCodes).toContain("tasklist_keep_sealed_execution");
  });

  it("prefers plan step intents over objective prose", () => {
    const result = materializeExecutionDesk({
      plan: {
        schemaVersion: 1,
        id: "plan_1",
        objective: "HTTP desugar",
        phases: [
          {
            id: "change",
            name: "Change",
            steps: [
              {
                id: "s1",
                intent: "Desugar nested http.start",
                actionSummary: "Return [start, http, stop]",
                targetRefs: [],
              },
              {
                id: "s2",
                intent: "Add compile tests",
                targetRefs: [],
              },
            ],
          },
        ],
      } as never,
      // Raw ask must not invent a desk when plan steps exist.
      seedText: "please improve the checks package somehow",
    });
    expect(result.status).toBe("applied");
    expect(result.taskList?.items.length).toBeGreaterThanOrEqual(1);
    expect(result.taskList?.items[0]?.title).toMatch(/Desugar|compile/i);
    // Must not invent from the raw ask when plan structure exists.
    expect(
      result.taskList?.items.some((item) =>
        /improve the checks package/i.test(item.title),
      ),
    ).toBe(false);
  });

  it("clears a weak invented desk when no steppers exist", () => {
    const weak = {
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "agent" as const,
      purpose: "execution" as const,
      items: [
        {
          id: "a",
          title: "I need you to redesign how HTTP checks work in this…",
          status: "active" as const,
        },
      ],
    };
    const result = materializeExecutionDesk({
      current: weak,
      seedText: "please improve the checks package somehow",
    });
    expect(result.clearedWeak).toBe(true);
    expect(result.taskList).toBeUndefined();
    expect(result.reasonCodes).toContain("tasklist_cleared_weak_seed");
  });
});

describe("reconcileExecutionDeskOnFinish", () => {
  it("does not reseed a healthy desk", () => {
    const current = {
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "plan" as const,
      purpose: "execution" as const,
      items: [
        { id: "s1", title: "Ship the change", status: "active" as const },
      ],
    };
    const result = reconcileExecutionDeskOnFinish({
      current,
      answer: "1. Extra work\n2. More work",
    });
    expect(result.reasonCodes).toContain("tasklist_finish_keep_desk");
    expect(result.taskList).toEqual(current);
  });

  it("clears leaked discovery so Continue is not Find relevant entrypoint", () => {
    const discovery = {
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "discovery" as const,
      purpose: "discovery" as const,
      title: "Investigating request",
      items: [
        {
          id: "find-entrypoint",
          title: "Find relevant entrypoint",
          status: "active" as const,
        },
        {
          id: "read-state",
          title: "Read related state flow",
          status: "pending" as const,
        },
      ],
    };
    const result = reconcileExecutionDeskOnFinish({
      current: discovery,
      answer: "Would you like me to apply Phase 1 first?",
    });
    expect(result.clearedWeak).toBe(true);
    expect(result.taskList).toBeUndefined();
    expect(result.reasonCodes).toContain("tasklist_cleared_discovery");
  });
});
