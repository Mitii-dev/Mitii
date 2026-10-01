import { describe, expect, it } from "vitest";

import {
  buildStepEvidenceGateMessage,
  buildStepPatchRequiredMessage,
  evaluateActiveStepMutateReadiness,
  resolveMutateReadinessBudget,
  resolveStepReadonlyTurnsBeforeGate,
  shouldDemandEvidenceBeforePatch,
} from "./index";
import type { TaskList } from "../../../../modules/task-list";
import { createLoopFileReadTracker, recordLoopFileReads } from "../../actions/isExplorationRereadHeavy";

function taskList(items: TaskList["items"]): TaskList {
  return {
    schemaVersion: 1,
    source: "plan",
    purpose: "execution",
    items,
  };
}

describe("mutateReadiness (per-step evidence → patch)", () => {
  it("sizes small/medium/large budgets for token efficiency", () => {
    expect(resolveMutateReadinessBudget("small").readonlyTurnsBeforeGate).toBe(2);
    expect(resolveMutateReadinessBudget("medium").readonlyTurnsBeforeGate).toBe(4);
    expect(resolveMutateReadinessBudget("large").maxEvidencePaths).toBe(6);
    expect(
      resolveStepReadonlyTurnsBeforeGate({
        taskSize: "large",
        hasPlan: true,
        maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: 4,
      }),
    ).toBe(4);
  });

  it("demands named evidence for the active step before patch", () => {
    const list = taskList([
      {
        id: "step-1",
        title: "Fix module boundaries",
        status: "active",
        write: ["packages/v8/tests/architecture/v8-module-boundaries.test.ts"],
        mustRead: ["packages/v8/src/engine/v8-engine/index.ts"],
      },
    ]);
    const reads = createLoopFileReadTracker();
    const unread = evaluateActiveStepMutateReadiness({
      taskList: list,
      loopFileReads: reads,
      maxEvidencePaths: 5,
    });
    expect(unread.ready).toBe(false);
    expect(unread.missingPaths).toContain(
      "packages/v8/src/engine/v8-engine/index.ts",
    );
    expect(unread.missingPaths).toContain(
      "packages/v8/tests/architecture/v8-module-boundaries.test.ts",
    );
    expect(unread.estFilesThisStep).toBeGreaterThanOrEqual(1);
    expect(shouldDemandEvidenceBeforePatch({
      readiness: unread,
      evidenceGateNudges: 0,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    })).toBe(true);

    const gate = buildStepEvidenceGateMessage(unread);
    expect(gate).toMatch(/enough_to_patch: false/);
    expect(gate).toMatch(/RequiredEvidenceBeforePatch/);
    expect(gate).toMatch(/NOT done/i);
    expect(gate).not.toMatch(/mutations? (are|were) done/i);

    recordLoopFileReads(reads, [
      "packages/v8/src/engine/v8-engine/index.ts",
      "packages/v8/tests/architecture/v8-module-boundaries.test.ts",
    ]);
    const ready = evaluateActiveStepMutateReadiness({
      taskList: list,
      loopFileReads: reads,
      maxEvidencePaths: 5,
    });
    expect(ready.ready).toBe(true);
    expect(shouldDemandEvidenceBeforePatch({
      readiness: ready,
      evidenceGateNudges: 0,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    })).toBe(false);

    const patchMsg = buildStepPatchRequiredMessage(ready);
    expect(patchMsg).toMatch(/enough_to_patch: true/);
    expect(patchMsg).toMatch(/apply_patch NOW/i);
    expect(patchMsg).toMatch(/NOT done/i);
  });

  it("treats steps without named paths as ready for soft patch demand", () => {
    const readiness = evaluateActiveStepMutateReadiness({
      taskList: taskList([
        { id: "a", title: "Investigate", status: "active" },
      ]),
      maxEvidencePaths: 5,
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.missingPaths).toEqual([]);
  });
});
