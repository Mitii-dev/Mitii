import { describe, expect, it, vi } from "vitest";

import { applyPostPlanTaskListGate } from "./applyPostPlanTaskListGate";

describe("applyPostPlanTaskListGate", () => {
  it("skips hollow suspend when strategy is clarify (A/B/C owns it)", async () => {
    const syncTaskListOnce = vi.fn();
    const finish = vi.fn();
    const result = await applyPostPlanTaskListGate({
      runtime: {
        deps: {},
        emit: vi.fn(),
        emitTaskListUpdated: vi.fn(),
        safeUnpin: vi.fn(),
        isoNow: () => "now",
      } as never,
      mediumOrLarge: true,
      mode: "agent",
      plan: {
        schemaVersion: 1,
        objective: "big ask",
        assumptions: [],
        openQuestions: ["what?"],
        contextReviewed: [],
        constraints: [],
        phases: [
          {
            id: "change",
            name: "Change",
            steps: [{ id: "step-open-questions", title: "Clarify" }],
          },
        ],
        risks: [],
        verification: { checks: [] },
        approvalRequired: false,
      } as never,
      planStrategy: {
        schemaVersion: 1,
        strategy: "clarify",
        rationale: "insufficient",
        confidence: 0.9,
      },
      seed: undefined,
      shared: { requestId: "r1", pinnedState: undefined } as never,
      taskListRef: { current: undefined, maxTasks: 20 } as never,
      reasonCodes: [],
      warnings: [],
      syncTaskListOnce,
      bus: {} as never,
      runId: "run_1",
      input: {} as never,
      decision: { route: "execute", planningDepth: "visible" } as never,
      budget: { snapshot: () => ({}) } as never,
      startedMs: 1,
      finish,
    });
    expect(result).toEqual({ kind: "continue" });
    expect(finish).not.toHaveBeenCalled();
    expect(syncTaskListOnce).toHaveBeenCalled();
  });

  it("promotes plan Change targetRefs into a trusted execution seed", async () => {
    const shared = {
      requestId: "r1",
      pinnedState: undefined,
      executionSeed: {
        paths: [],
        symbols: [],
        causeNotes: [],
        confidence: "weak" as const,
        source: "none" as const,
      },
    };
    const reasonCodes: string[] = [];
    const result = await applyPostPlanTaskListGate({
      runtime: {
        deps: {},
        emit: vi.fn(),
        emitTaskListUpdated: vi.fn(),
        safeUnpin: vi.fn(),
        isoNow: () => "now",
      } as never,
      mediumOrLarge: true,
      mode: "agent",
      plan: {
        schemaVersion: 1,
        objective: "Build Run Profiles",
        assumptions: [],
        openQuestions: [],
        contextReviewed: [],
        constraints: [],
        phases: [
          {
            id: "change",
            name: "Change",
            steps: [
              {
                id: "step-profiles",
                intent: "Add profiles.ts",
                actionSummary: "Create profile definitions",
                targetRefs: ["test/shared/config/profiles.ts"],
              },
            ],
          },
        ],
        risks: [],
        verification: { checks: [] },
        approvalRequired: false,
      } as never,
      planStrategy: {
        schemaVersion: 1,
        strategy: "discover_and_plan",
        rationale: "feature",
        confidence: 0.9,
      },
      seed: shared.executionSeed,
      shared: shared as never,
      taskListRef: { current: undefined, maxTasks: 20 } as never,
      reasonCodes: reasonCodes as never,
      warnings: [],
      syncTaskListOnce: vi.fn(),
      bus: {} as never,
      runId: "run_1",
      input: {} as never,
      decision: { route: "execute", planningDepth: "visible" } as never,
      budget: { snapshot: () => ({}) } as never,
      startedMs: 1,
      finish: vi.fn() as never,
    });
    expect(result.kind).toBe("continue");
    expect(reasonCodes).toContain("execution_seed_from_plan");
    expect(shared.executionSeed.confidence).toBe("trusted");
    expect(shared.executionSeed.paths).toContain(
      "test/shared/config/profiles.ts",
    );
  });

  it("still gates hollow plans when strategy was remapped off clarify", async () => {
    const finish = vi.fn((partial) => partial);
    const reasonCodes: string[] = [];
    const result = await applyPostPlanTaskListGate({
      runtime: {
        deps: {},
        emit: vi.fn(),
        emitTaskListUpdated: vi.fn(),
        safeUnpin: vi.fn(),
        isoNow: () => "now",
      } as never,
      mediumOrLarge: true,
      mode: "agent",
      plan: {
        schemaVersion: 1,
        objective: "Build Run Profiles",
        assumptions: [],
        openQuestions: ["A or B?"],
        contextReviewed: [],
        constraints: [],
        phases: [
          {
            id: "change",
            name: "Change",
            steps: [
              {
                id: "step-open-questions",
                intent: "Resolve open questions",
                actionSummary: "Clarify",
              },
            ],
          },
        ],
        risks: [],
        verification: { checks: [] },
        approvalRequired: false,
      } as never,
      // Remapped clear-ask path must not skip concreteness.
      planStrategy: {
        schemaVersion: 1,
        strategy: "discover_and_plan",
        rationale: "Clear single-outcome ask",
        confidence: 0.9,
        skipDiscover: true,
      },
      seed: undefined,
      shared: { requestId: "r1", pinnedState: undefined } as never,
      taskListRef: { current: undefined, maxTasks: 20 } as never,
      reasonCodes: reasonCodes as never,
      warnings: [],
      syncTaskListOnce: vi.fn(),
      bus: {} as never,
      runId: "run_1",
      input: {} as never,
      decision: { route: "execute", planningDepth: "visible" } as never,
      budget: { snapshot: () => ({}) } as never,
      startedMs: 1,
      finish: finish as never,
    });
    expect(result.kind).toBe("terminal");
    expect(reasonCodes).toContain("task_list_plan_not_concrete");
    expect(finish).toHaveBeenCalled();
  });
});
