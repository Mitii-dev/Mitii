import { describe, expect, it } from "vitest";

import {
  buildStepEvidenceGateMessage,
  buildStepPatchRequiredMessage,
  evaluateActiveStepMutateReadiness,
  filterToolsForMutateLock,
  isMutateLockAllowedToolName,
  mutateLockModelRequestFields,
  resolveMutateLockAllowTargetedReads,
  resolveMutateReadinessBudget,
  resolveStepReadonlyTurnsBeforeGate,
  shouldDemandEvidenceBeforePatch,
  shouldRearmMutateLockOnContinue,
} from "../../helpers/loop-rails/mutate-readiness";
import type { TaskList } from "../../../modules/task-list";
import type { ModelToolDefinition } from "../../../modules/model-gateway";
import {
  createLoopFileReadTracker,
  recordLoopFileReads,
} from "../../helpers/loop-rails/loop-file-reads/LoopFileReads";

function taskList(items: TaskList["items"]): TaskList {
  return {
    schemaVersion: 1,
    source: "plan",
    purpose: "execution",
    items,
  };
}

describe("mutateReadiness (per-step evidence → patch)", () => {
  it("sizes small/medium/large bind budgets by taskSize × window band", () => {
    expect(resolveMutateReadinessBudget("small").readonlyTurnsBeforeGate).toBe(
      6,
    );
    expect(resolveMutateReadinessBudget("small").maxEvidencePaths).toBe(8);
    expect(
      resolveMutateReadinessBudget("medium", "standard").readonlyTurnsBeforeGate,
    ).toBe(4);
    expect(
      resolveMutateReadinessBudget("medium", "standard").maxEvidencePaths,
    ).toBe(8);
    expect(
      resolveMutateReadinessBudget("medium", "standard")
        .maxEvidenceGateNudgesBeforePatchDemand,
    ).toBe(3);
    expect(
      resolveMutateReadinessBudget("medium", "wide").readonlyTurnsBeforeGate,
    ).toBe(3);
    expect(
      resolveMutateReadinessBudget("medium", "wide").maxEvidencePaths,
    ).toBe(8);
    expect(resolveMutateReadinessBudget("large").maxEvidencePaths).toBe(12);
    expect(
      resolveMutateReadinessBudget("medium").evidenceRecoveryTurns,
    ).toBe(2);
    expect(
      resolveMutateReadinessBudget("medium").evidenceRecoveryMaxPaths,
    ).toBe(4);
    // Turns = model/tool-loop turns; window tokens map via band.
    expect(
      resolveMutateReadinessBudget("medium", 40_000).readonlyTurnsBeforeGate,
    ).toBe(5);
    expect(
      resolveMutateReadinessBudget("medium", 120_000).readonlyTurnsBeforeGate,
    ).toBe(3);
    expect(
      resolveStepReadonlyTurnsBeforeGate({
        taskSize: "large",
        hasPlan: true,
        maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: 2,
        windowBandOrTokens: "standard",
      }),
    ).toBe(2);
    // Trusted seed keeps the size×band envelope (do not collapse to afterPlan=2).
    expect(
      resolveStepReadonlyTurnsBeforeGate({
        taskSize: "small",
        hasPlan: true,
        maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: 2,
        windowBandOrTokens: "standard",
        seedTrusted: true,
      }),
    ).toBe(6);
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
    expect(
      shouldDemandEvidenceBeforePatch({
        readiness: unread,
        evidenceGateNudges: 0,
        maxEvidenceGateNudgesBeforePatchDemand: 2,
      }),
    ).toBe(true);

    const gate = buildStepEvidenceGateMessage(unread);
    expect(gate).toMatch(/enough_to_patch: false/);
    expect(gate).toMatch(/RequiredEvidenceBeforePatch/);
    expect(gate).toMatch(/NOT done/i);
    expect(gate).not.toMatch(/mutations? (are|were) done/i);

    recordLoopFileReads(
      reads,
      [
        "packages/v8/src/engine/v8-engine/index.ts",
        "packages/v8/tests/architecture/v8-module-boundaries.test.ts",
      ],
      { fullyLoaded: true },
    );
    const ready = evaluateActiveStepMutateReadiness({
      taskList: list,
      loopFileReads: reads,
      maxEvidencePaths: 5,
    });
    expect(ready.ready).toBe(true);
    expect(
      shouldDemandEvidenceBeforePatch({
        readiness: ready,
        evidenceGateNudges: 0,
        maxEvidenceGateNudgesBeforePatchDemand: 2,
      }),
    ).toBe(false);

    const patchMsg = buildStepPatchRequiredMessage(ready);
    expect(patchMsg).toMatch(/enough_to_patch: true/);
    expect(patchMsg).toMatch(/apply_patch NOW/i);
    expect(patchMsg).toMatch(/NOT done/i);
  });
});

