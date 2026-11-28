/**
 * After a settled tool batch: finish-after-verified, soft nudge, mutate/readonly
 * rails, diagnose answer lock, and tool-loop force-final.
 */
import { synthesizeFallbackAnswer } from "../actions/isIncompleteAssistantTurn";
import { shouldFinishAfterVerifiedMutation } from "../actions/shouldFinishAfterVerifiedMutation";
import {
  forceFinalToolLoopMessage,
  softToolLoopNudgeMessage,
} from "../modules/tool-loop-guard";
import { applyAfterToolSettleDiagnoseRails } from "./advanceAfterToolSettleDiagnose";
import { applyAfterToolSettleMutateRails } from "./advanceAfterToolSettleMutateRails";
import type {
  AdvanceAfterToolSettleParams,
  AdvanceAfterToolSettleResult,
  AfterToolSettleState,
} from "./advanceAfterToolSettleTypes";
import type { ToolLoopOutcome } from "./types";

export type {
  AfterToolSettleState,
  AdvanceAfterToolSettleResult,
  AdvanceAfterToolSettleParams,
} from "./advanceAfterToolSettleTypes";

export function advanceAfterToolSettle(
  params: AdvanceAfterToolSettleParams,
): AdvanceAfterToolSettleResult {
  const {
    runtime,
    bus,
    runId,
    settled,
    softNudgeAfterSettle,
    toolCalls,
    turnContent,
    messages,
    toolCache,
    toolLoopGuard,
    changedFiles,
    mutationCheckpointIds,
    taskListRef,
    evidence,
    budget,
    reasonCodes,
    warnings,
    mutationNeeded,
    vcsHistoryRewrite,
    planDraftedThisRun,
    seedTrusted,
    stepReadonlyTurnsBeforeGate,
    readonlyTurnsBeforeMutationNudge,
    mutateReadinessBudget,
    changeImpactGate,
    evaluateStepReadiness,
    loopFileReads,
    thresholds,
    offerContinue,
  } = params;

  const state: AfterToolSettleState = { ...params.state };

  const snapshot = (): AfterToolSettleState => ({ ...state });
  const done = (outcome: ToolLoopOutcome): AdvanceAfterToolSettleResult => ({
    kind: "done",
    outcome,
    state: snapshot(),
  });
  const cont = (): AdvanceAfterToolSettleResult => ({
    kind: "continue",
    state: snapshot(),
  });

  if (
    shouldFinishAfterVerifiedMutation({
      mutationApplied:
        changedFiles.length > 0 ||
        state.gitWriteSucceeded ||
        settled.stats.succeededGitWrite,
      batchHadSuccessfulMutation:
        settled.stats.succeededMutating || settled.stats.succeededGitWrite,
      batchHadRejectedMutation: settled.stats.rejectedMutation !== undefined,
      openTaskCount: (taskListRef.current?.items ?? []).filter(
        (item) => item.status === "pending" || item.status === "active",
      ).length,
      batch: toolCalls.map((call) => ({
        toolName: call.name,
        result: toolCache.get(call.id),
      })),
    })
  ) {
    // Verification passed after the last edit: end the loop; the
    // verification gate decides. No extra free-form narration turn.
    reasonCodes.push(
      "loop_finished_after_verified_mutation",
      "mutation_applied",
    );
    if (state.answer.trim().length === 0) {
      state.answer = synthesizeFallbackAnswer({
        priorAnswer: turnContent,
        changedFiles,
      });
    }
    return done({
      kind: "completed",
      answer: state.answer,
      changedFiles,
      mutationCheckpointIds,
      messages,
      toolCache,
      decision: state.decision,
    });
  }

  if (softNudgeAfterSettle) {
    messages.push({
      role: "user",
      content: softToolLoopNudgeMessage(thresholds.toolLoopSoftIdentical),
    });
  }

  const mutateOutcome = applyAfterToolSettleMutateRails({
    runtime,
    bus,
    runId,
    settled,
    toolCalls,
    messages,
    taskListRef,
    evidence,
    reasonCodes,
    warnings,
    mutationNeeded,
    vcsHistoryRewrite,
    planDraftedThisRun,
    seedTrusted,
    stepReadonlyTurnsBeforeGate,
    readonlyTurnsBeforeMutationNudge,
    mutateReadinessBudget,
    changeImpactGate,
    evaluateStepReadiness,
    loopFileReads,
    thresholds,
    budgetCanStartModelCall: budget.canStartModelCall(),
    changedFiles,
    state,
    done,
    offerContinue,
  });
  if (mutateOutcome) {
    return mutateOutcome;
  }

  applyAfterToolSettleDiagnoseRails({
    settled,
    toolCalls,
    messages,
    reasonCodes,
    warnings,
    mutationNeeded,
    budgetCanStartModelCall: budget.canStartModelCall(),
    thresholds,
    state,
  });

  if (toolLoopGuard.isForcingFinalResponse()) {
    state.forceFinalOnly = true;
    messages.push({
      role: "user",
      content: forceFinalToolLoopMessage(
        thresholds.toolLoopIdenticalCallAndResult,
      ),
    });
  }

  return cont();
}
