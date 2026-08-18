import { AGENT_ENGINE_THRESHOLDS } from "../policy";

export type VerificationRepairStopReason =
  | "continue"
  | "budget"
  | "quick_cap"
  | "max_attempts"
  | "stalled";

export interface ShouldContinueVerificationRepairInput {
  repairAttempts: number;
  explorationDepth?: "auto" | "quick" | "deep";
  consecutiveStalledRepairs: number;
  canStartModelCall: boolean;
  /** Window-effort cap. When 0, never start a repair loop. */
  maxAttempts?: number;
}

/**
 * Whether Agent Engine should inject another remaining-error repair loop.
 * Quick exploration stays at one repair; auto/deep keep going while the
 * error count is dropping and the run budget remains.
 */
export function shouldContinueVerificationRepair(
  input: ShouldContinueVerificationRepairInput,
): { continue: boolean; reason: VerificationRepairStopReason } {
  if (!input.canStartModelCall) {
    return { continue: false, reason: "budget" };
  }

  const maxAttempts =
    input.maxAttempts ?? maxVerificationRepairsForDepth(input.explorationDepth);
  if (input.repairAttempts >= maxAttempts) {
    return {
      continue: false,
      reason: input.explorationDepth === "quick" ? "quick_cap" : "max_attempts",
    };
  }

  if (
    input.repairAttempts > 0 &&
    input.consecutiveStalledRepairs >=
      AGENT_ENGINE_THRESHOLDS.maxStalledVerificationRepairs
  ) {
    return { continue: false, reason: "stalled" };
  }

  return { continue: true, reason: "continue" };
}

export function maxVerificationRepairsForDepth(
  explorationDepth?: "auto" | "quick" | "deep",
): number {
  if (explorationDepth === "quick") {
    return 1;
  }
  return AGENT_ENGINE_THRESHOLDS.maxVerificationRepairAttempts;
}

export function nextStalledRepairCount(params: {
  previousAfterErrorCount?: number;
  currentAfterErrorCount: number;
  consecutiveStalledRepairs: number;
}): number {
  if (params.previousAfterErrorCount === undefined) {
    return 0;
  }
  if (params.currentAfterErrorCount < params.previousAfterErrorCount) {
    return 0;
  }
  return params.consecutiveStalledRepairs + 1;
}
