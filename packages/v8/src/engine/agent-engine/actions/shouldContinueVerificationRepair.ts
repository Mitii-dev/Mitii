import { AGENT_ENGINE_THRESHOLDS } from "../policy";
import type { AgentEngineThresholds } from "./resolveAgentEngineThresholds";

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
  thresholds?: Pick<
    AgentEngineThresholds,
    "maxStalledVerificationRepairs" | "maxVerificationRepairAttempts"
  >;
}

/**
 * Whether Agent Engine should inject another remaining-error repair loop.
 * Quick exploration stays at one repair; auto/deep keep going while the
 * error count is dropping and the window-effort / run budget remain.
 */
export function shouldContinueVerificationRepair(
  input: ShouldContinueVerificationRepairInput,
): { continue: boolean; reason: VerificationRepairStopReason } {
  const thresholds = input.thresholds ?? AGENT_ENGINE_THRESHOLDS;
  if (!input.canStartModelCall) {
    return { continue: false, reason: "budget" };
  }

  if (input.explorationDepth === "quick") {
    const quickCap = maxVerificationRepairsForDepth("quick", thresholds);
    if (input.repairAttempts >= quickCap) {
      return { continue: false, reason: "quick_cap" };
    }
  }

  const maxAttempts =
    input.maxAttempts ??
    maxVerificationRepairsForDepth(input.explorationDepth, thresholds);
  if (input.repairAttempts >= maxAttempts) {
    return { continue: false, reason: "max_attempts" };
  }

  if (
    input.repairAttempts > 0 &&
    input.consecutiveStalledRepairs >= thresholds.maxStalledVerificationRepairs
  ) {
    return { continue: false, reason: "stalled" };
  }

  return { continue: true, reason: "continue" };
}

export function maxVerificationRepairsForDepth(
  explorationDepth?: "auto" | "quick" | "deep",
  thresholds: Pick<
    AgentEngineThresholds,
    "maxVerificationRepairAttempts"
  > = AGENT_ENGINE_THRESHOLDS,
): number {
  if (explorationDepth === "quick") {
    return 1;
  }
  return thresholds.maxVerificationRepairAttempts;
}

/**
 * Hold back a slice of maxModelCalls from the first mutate loop so
 * remaining-error repairs can start. Without this, a productive first loop
 * consumes the whole ceiling and `maxVerificationRepairs` never runs.
 */
export function reservedVerificationRepairModelCalls(input: {
  maxModelCalls: number;
  maxVerificationRepairs: number;
  thresholds?: Pick<
    AgentEngineThresholds,
    "verificationRepairModelCallReserveRatio"
  >;
}): number {
  if (input.maxVerificationRepairs <= 0 || input.maxModelCalls <= 1) {
    return 0;
  }
  const ratio =
    input.thresholds?.verificationRepairModelCallReserveRatio ??
    AGENT_ENGINE_THRESHOLDS.verificationRepairModelCallReserveRatio;
  const byShare = Math.floor(input.maxModelCalls * ratio);
  const reserved = Math.min(
    input.maxVerificationRepairs,
    Math.max(1, byShare),
  );
  return Math.min(reserved, input.maxModelCalls - 1);
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
