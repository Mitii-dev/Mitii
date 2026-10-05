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
} from "./index";
import type { TaskList } from "../../../../modules/task-list";
import type { ModelToolDefinition } from "../../../../modules/model-gateway";
import {
  createLoopFileReadTracker,
  recordLoopFileReads,
} from "../../actions/isExplorationRereadHeavy";

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

  it("treats steps without named paths as ready only when mutation is not required", () => {
    const soft = evaluateActiveStepMutateReadiness({
      taskList: taskList([
        { id: "a", title: "Investigate", status: "active" },
      ]),
      maxEvidencePaths: 5,
    });
    expect(soft.ready).toBe(true);
    expect(soft.missingPaths).toEqual([]);

    const mutating = evaluateActiveStepMutateReadiness({
      taskList: taskList([
        { id: "a", title: "Investigate", status: "active" },
      ]),
      maxEvidencePaths: 5,
      mutationRequired: true,
    });
    expect(mutating.ready).toBe(false);

    const seeded = evaluateActiveStepMutateReadiness({
      taskList: taskList([
        { id: "a", title: "Investigate", status: "active" },
      ]),
      maxEvidencePaths: 5,
      mutationRequired: true,
      seedTrusted: true,
      seedPaths: ["apps/desktop/src/renderer/SettingsPanel.tsx"],
    });
    expect(seeded.ready).toBe(false);
    expect(seeded.writePaths).toContain(
      "apps/desktop/src/renderer/SettingsPanel.tsx",
    );
    expect(seeded.missingPaths).toContain(
      "apps/desktop/src/renderer/SettingsPanel.tsx",
    );
  });

  it("does not mark truncated windowed reads as fully loaded evidence", () => {
    const list = taskList([
      {
        id: "step-1",
        title: "Edit large case file",
        status: "active",
        write: ["scripts/data/node-ecosystem-cases.mjs"],
        mustRead: ["scripts/data/node-ecosystem-cases.mjs"],
      },
    ]);
    const reads = createLoopFileReadTracker();
    recordLoopFileReads(reads, ["scripts/data/node-ecosystem-cases.mjs"]);
    expect(
      evaluateActiveStepMutateReadiness({
        taskList: list,
        loopFileReads: reads,
        maxEvidencePaths: 5,
      }).ready,
    ).toBe(false);

    recordLoopFileReads(
      reads,
      ["scripts/data/node-ecosystem-cases.mjs"],
      { fullyLoaded: true },
    );
    expect(
      evaluateActiveStepMutateReadiness({
        taskList: list,
        loopFileReads: reads,
        maxEvidencePaths: 5,
      }).ready,
    ).toBe(true);
  });

  it("strips discovery tools under mutate lock but keeps apply_patch", () => {
    const tools = [
      { name: "apply_patch", description: "patch", inputSchema: {} },
      { name: "read_file", description: "read", inputSchema: {} },
      { name: "search_files", description: "search", inputSchema: {} },
      { name: "list_directory", description: "list", inputSchema: {} },
      { name: "run_command", description: "cmd", inputSchema: {} },
      { name: "analyze_change_impact", description: "impact", inputSchema: {} },
      { name: "glob_files", description: "glob", inputSchema: {} },
    ] as ModelToolDefinition[];

    const withReads = filterToolsForMutateLock(tools, {
      allowTargetedReads: true,
    });
    expect(withReads?.map((t) => t.name).sort()).toEqual([
      "analyze_change_impact",
      "apply_patch",
      "read_file",
    ]);

    const mutateOnly = filterToolsForMutateLock(tools, {
      allowTargetedReads: false,
    });
    expect(mutateOnly?.map((t) => t.name).sort()).toEqual([
      "analyze_change_impact",
      "apply_patch",
    ]);

    // settleTools execution gate: search_files must be tool_not_allowed under lock
    expect(
      isMutateLockAllowedToolName("search_files", { allowTargetedReads: true }),
    ).toBe(false);
    expect(
      isMutateLockAllowedToolName("search_files", {
        allowTargetedReads: false,
      }),
    ).toBe(false);
    expect(
      isMutateLockAllowedToolName("apply_patch", { allowTargetedReads: false }),
    ).toBe(true);
    expect(
      isMutateLockAllowedToolName("read_file", { allowTargetedReads: true }),
    ).toBe(true);
    expect(
      isMutateLockAllowedToolName("read_file", { allowTargetedReads: false }),
    ).toBe(false);

    const forced = mutateLockModelRequestFields(tools, {
      allowTargetedReads: false,
    });
    expect(forced.toolChoice).toBe("required");

    const soft = mutateLockModelRequestFields(tools, {
      allowTargetedReads: true,
    });
    expect(soft.toolChoice).toBe("auto");

    expect(
      resolveMutateLockAllowTargetedReads({
        readinessReady: true,
        evidenceGateActive: false,
      }),
    ).toBe(false);
    expect(
      resolveMutateLockAllowTargetedReads({
        readinessReady: false,
        evidenceGateActive: true,
      }),
    ).toBe(true);

    expect(
      shouldRearmMutateLockOnContinue({
        wallReason: "unfulfilled_execute",
        changedFileCount: 0,
        mutationRequired: true,
      }),
    ).toBe(true);
    expect(
      shouldRearmMutateLockOnContinue({
        wallReason: "evidence_clarify",
        changedFileCount: 0,
        mutationRequired: true,
      }),
    ).toBe(false);
    expect(
      shouldRearmMutateLockOnContinue({
        wallReason: "unfulfilled_execute",
        changedFileCount: 0,
        mutationRequired: true,
        reasonCodes: ["evidence_recovery_exhausted"],
      }),
    ).toBe(false);
    // Phase 3: exhaustion sticky is owned by shouldStripDiscoveryAfterEvidenceExhaustion
    // (resumeToolLoop ORs it so discovery stays stripped even when rearm is false).
    expect(
      shouldRearmMutateLockOnContinue({
        wallReason: "unfulfilled_execute",
        changedFileCount: 2,
        mutationRequired: true,
      }),
    ).toBe(false);
  });
});
