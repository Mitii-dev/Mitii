/**
 * Tool-loop guard + truncation/reasoning-abort rails before settle.
 */
import { applyPreSettleToolLoopGuard } from "./handlePreSettleToolLoopGuard";
import { applyPreSettleTruncationRails } from "./handlePreSettleTruncationRails";
import type {
  HandlePreSettleTurnRailsParams,
  PreSettleRailsResult,
  PreSettleRailsState,
} from "./handlePreSettleTurnRailsTypes";
import type { ToolLoopOutcome } from "./types";

export type {
  PreSettleRailsState,
  PreSettleRailsResult,
  HandlePreSettleTurnRailsParams,
} from "./handlePreSettleTurnRailsTypes";

export function handlePreSettleTurnRails(
  params: HandlePreSettleTurnRailsParams,
): PreSettleRailsResult {
  const {
    runtime,
    bus,
    runId,
    turnContent,
    finishReason,
    reasoningBudgetExceeded,
    toolCalls,
    discardedCount,
    messages,
    toolLoopGuard,
    answer,
    reasonCodes,
    warnings,
    mutationNeeded,
    changedFiles,
    gitWriteSucceeded,
    taskListRef,
    evidence,
    seedTrusted,
    stepReadonlyTurnsBeforeGate,
    readonlyTurnsBeforeMutationNudge,
    mutateReadinessBudget,
    evaluateStepReadiness,
    planDraftedThisRun,
    vcsHistoryRewrite,
    loopFileReads,
    thresholds,
    offerContinue,
  } = params;

  const state: PreSettleRailsState = {
    softNudgeAfterSettle: false,
    ...params.state,
  };

  const snapshot = (): PreSettleRailsState => ({ ...state });
  const cont = (): PreSettleRailsResult => ({
    kind: "continue",
    state: snapshot(),
  });
  const done = (outcome: ToolLoopOutcome): PreSettleRailsResult => ({
    kind: "done",
    outcome,
    state: snapshot(),
  });
  const proceed = (): PreSettleRailsResult => ({
    kind: "proceed",
    state: snapshot(),
  });

  const guardOutcome = applyPreSettleToolLoopGuard({
    runtime,
    bus,
    runId,
    turnContent,
    toolCalls,
    messages,
    toolLoopGuard,
    answer,
    warnings,
    offerContinue,
    state,
    cont,
    done,
  });
  if (guardOutcome) {
    return guardOutcome;
  }

  const truncationOutcome = applyPreSettleTruncationRails({
    runtime,
    bus,
    runId,
    turnContent,
    finishReason,
    reasoningBudgetExceeded,
    toolCalls,
    discardedCount,
    messages,
    answer,
    reasonCodes,
    warnings,
    mutationNeeded,
    changedFiles,
    gitWriteSucceeded,
    taskListRef,
    evidence,
    seedTrusted,
    stepReadonlyTurnsBeforeGate,
    readonlyTurnsBeforeMutationNudge,
    mutateReadinessBudget,
    evaluateStepReadiness,
    planDraftedThisRun,
    vcsHistoryRewrite,
    loopFileReads,
    thresholds,
    offerContinue,
    state,
    cont,
    done,
  });
  if (truncationOutcome) {
    return truncationOutcome;
  }

  return proceed();
}
