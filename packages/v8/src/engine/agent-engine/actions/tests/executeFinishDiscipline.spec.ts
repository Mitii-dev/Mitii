import { describe, expect, it } from "vitest";

import { AGENT_ENGINE_THRESHOLDS } from "../../policy";
import { resolveLoopPolicyWindowBand } from "../../policy/loopPolicyBands";
import { resolveLoopPolicyBandThresholds } from "../resolveLoopPolicyThresholds";
import { isUnfulfilledExecute } from "../resolveLoopTurnOutcome";
import {
  buildBudgetWallRationale,
  buildBudgetWallResetMessage,
} from "../buildStallContinueRationale";
import { MUTATION_BUDGET_PROFILES } from "../../../../modules/decision-policy/policy";
import {
  WINDOW_BUDGET_EFFORT_OVERLAY,
} from "../../../../modules/window-budget/effort";
import {
  WINDOW_BUDGET_BAND_TABLE,
} from "../../../../modules/window-budget/windowBudgetBands";
import { deriveWindowPolicy } from "../../../../modules/window-budget";
import { WINDOW_BUDGET_SCHEMA_VERSION } from "../../../../modules/window-budget/constants";

/**
 * Enterprise execute-finish discipline: mutation-first across all window
 * bands, smoother multi-file budgets, and Continue that forces a patch.
 */
describe("execute finish discipline (enterprise)", () => {
  it("scales explore + evidence room by band without starving compact (30k)", () => {
    const compact = resolveLoopPolicyBandThresholds(35_000);
    const standard = resolveLoopPolicyBandThresholds(75_000);
    const wide = resolveLoopPolicyBandThresholds(200_000);

    expect(compact.band).toBe("compact");
    expect(standard.band).toBe("standard");
    expect(wide.band).toBe("wide");

    expect(compact.thresholds.maxReadOnlyToolTurnsBeforeMutationNudge).toBe(15);
    expect(standard.thresholds.maxReadOnlyToolTurnsBeforeMutationNudge).toBe(
      AGENT_ENGINE_THRESHOLDS.maxReadOnlyToolTurnsBeforeMutationNudge,
    );
    expect(wide.thresholds.maxReadOnlyToolTurnsBeforeMutationNudge).toBe(18);

    expect(compact.thresholds.maxUnfulfilledExecuteRecoveries).toBe(4);
    expect(standard.thresholds.maxUnfulfilledExecuteRecoveries).toBe(2);
    expect(compact.thresholds.maxPostNudgeEvidenceReadTurns).toBe(6);
    expect(standard.thresholds.maxPostNudgeEvidenceReadTurns).toBe(2);
    expect(wide.thresholds.maxPostNudgeEvidenceReadTurns).toBe(8);
    expect(compact.thresholds.maxVerificationRepairAttempts).toBe(4);
    expect(compact.thresholds.maxStalledVerificationRepairs).toBe(1);
    expect(compact.thresholds.maxReadOnlyToolTurnsAfterMutationNudges).toBe(2);

    // Wide never stricter on explore than compact.
    expect(
      wide.thresholds.maxReadOnlyToolTurnsBeforeMutationNudge,
    ).toBeGreaterThanOrEqual(
      compact.thresholds.maxReadOnlyToolTurnsBeforeMutationNudge,
    );
  });

  it("keeps compact tool-loop output tight so local models cannot pad to 13k", () => {
    const compact = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
    });
    const at45k = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 45_000,
    });
    expect(compact.maximumOutputTokens).toBe(3_600);
    // 45k × 0.12 = 5_400 (planning ceiling); tool-loop hard-caps at 5_000 separately.
    expect(at45k.maximumOutputTokens).toBe(5_400);
    expect(WINDOW_BUDGET_BAND_TABLE.compact.overrides.outputWindowCapRatio).toBe(
      0.12,
    );
  });

  it("treats empty diagnosis as unfulfilled execute on write+mutation", () => {
    expect(
      isUnfulfilledExecute({
        route: "execute",
        maximumWorkspaceEffect: "write",
        primaryTaskIntent: "feature",
        toolCallCount: 0,
        changedFileCount: 0,
        content: "",
        reasonCodes: ["mutation_execute"],
      }),
    ).toBe(true);

    expect(
      isUnfulfilledExecute({
        route: "execute",
        maximumWorkspaceEffect: "write",
        primaryTaskIntent: "feature",
        toolCallCount: 0,
        changedFileCount: 0,
        content:
          "Let me stop reading and start editing. I will add runCross next.",
        reasonCodes: ["mutation_execute"],
      }),
    ).toBe(true);
  });

  it("Continue reset after unfulfilled execute demands an immediate mutation", () => {
    const reset = buildBudgetWallResetMessage({
      reason: "unfulfilled_execute",
      mutationRequired: true,
      changedFiles: [],
    });
    expect(reset).toMatch(/MUST be apply_patch/i);
    expect(reset).toMatch(/Analysis-only turns are not allowed/i);
    expect(reset).toMatch(/up to five targeted read_file/i);
    expect(reset).not.toMatch(/dig a little deeper/i);
    expect(reset).not.toMatch(/Read tools are unavailable/i);

    const rationale = buildBudgetWallRationale({
      reason: "unfulfilled_execute",
      changedFiles: [],
      mutationRequired: true,
    });
    expect(rationale).toMatch(/workspace edit/i);
    expect(rationale).not.toMatch(/more research/i);
  });

  it("scales default file mutation budgets from 8/12/20 by band and effort", () => {
    expect(WINDOW_BUDGET_BAND_TABLE.compact.overrides.maxUniqueFilesPerCallCap).toBe(
      8,
    );
    expect(
      WINDOW_BUDGET_BAND_TABLE.standard.overrides.maxUniqueFilesPerCallCap,
    ).toBe(12);
    expect(WINDOW_BUDGET_BAND_TABLE.wide.overrides.maxUniqueFilesPerCallCap).toBe(
      20,
    );
    expect(WINDOW_BUDGET_EFFORT_OVERLAY.medium.maxUniqueFilesPerCall).toBe(12);
    expect(WINDOW_BUDGET_EFFORT_OVERLAY.high.maxUniqueFilesPerCall).toBe(20);
    expect(MUTATION_BUDGET_PROFILES.relaxed.preferredBatchSize).toBe(20);
    expect(MUTATION_BUDGET_PROFILES.tight.maxUniqueFilesPerCall).toBe(20);

    const compact = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 45_000,
      effort: "high",
    });
    const wide = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 200_000,
      effort: "high",
    });
    expect(compact.mutation.maxUniqueFilesPerCall).toBe(8);
    expect(wide.mutation.maxUniqueFilesPerCall).toBe(20);
    expect(wide.mutation.preferredBatchSize).toBe(20);
  });

  it("keeps band resolution stable for small and large windows", () => {
    expect(resolveLoopPolicyWindowBand(30_000)).toBe("compact");
    expect(resolveLoopPolicyWindowBand(65_000)).toBe("standard");
    expect(resolveLoopPolicyWindowBand(256_000)).toBe("wide");
  });
});
