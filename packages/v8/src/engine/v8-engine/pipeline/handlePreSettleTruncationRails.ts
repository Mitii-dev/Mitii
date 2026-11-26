/**
 * Pre-settle truncation / reasoning-abort recovery and mutate evidence pressure.
 */
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import type { EventBus } from "../internal/EventBus";
import type { TaskListRef } from "../internal/taskListRuntime";
import {
  decideTruncationRecovery,
  truncationWarningMessage,
} from "../modules/truncation";
import { readonlyThrashPartialAnswer } from "../modules/mutation-nudge";
import type { MutateReadinessBudget } from "../modules/mutate-readiness";
import type { evaluateActiveStepMutateReadiness } from "../modules/mutate-readiness";
import type { OfferContinueFn } from "./createOfferContinue";
import { applyReasoningAbortMutatePressure } from "./handlePreSettleReasoningMutate";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type {
  PreSettleRailsResult,
  PreSettleRailsState,
} from "./handlePreSettleTurnRailsTypes";

export function applyPreSettleTruncationRails(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  turnContent: string;
  finishReason: string | undefined;
  reasoningBudgetExceeded: boolean;
  toolCalls: readonly ModelToolCall[];
  discardedCount: number;
  messages: ModelMessage[];
  answer: string;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  mutationNeeded: boolean;
  changedFiles: string[];
  gitWriteSucceeded: boolean;
  taskListRef: TaskListRef;
  evidence: RunEvidence | undefined;
  seedTrusted: boolean;
  stepReadonlyTurnsBeforeGate: number;
  readonlyTurnsBeforeMutationNudge: number;
  mutateReadinessBudget: MutateReadinessBudget;
  evaluateStepReadiness: () => ReturnType<typeof evaluateActiveStepMutateReadiness>;
  planDraftedThisRun: boolean;
  vcsHistoryRewrite: boolean;
  loopFileReads: LoopFileReadTracker;
  thresholds: {
    maxTruncationRecoveries: number;
    maxReasoningAbortRecoveries: number;
    maxSoftMutationNudgesBeforeContinue: number;
  };
  offerContinue: OfferContinueFn;
  state: PreSettleRailsState;
  cont: () => PreSettleRailsResult;
  done: (outcome: ToolLoopOutcome) => PreSettleRailsResult;
}): PreSettleRailsResult | undefined {
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
  } = params;

  const recovery = decideTruncationRecovery({
    finishReason,
    reasoningBudgetExceeded: reasoningBudgetExceeded === true,
    hasToolCalls: toolCalls.length > 0,
    incompleteToolCalls: discardedCount > 0 && toolCalls.length === 0,
    truncationRecoveriesUsed: state.truncationRecoveriesUsed,
    maxTruncationRecoveries: thresholds.maxTruncationRecoveries,
    reasoningAbortRecoveriesUsed: state.reasoningAbortRecoveriesUsed,
    maxReasoningAbortRecoveries: thresholds.maxReasoningAbortRecoveries,
    requireMutation: mutationNeeded,
  });

  if (recovery.resetCounter) {
    // Tool progress clears provider length recoveries only. Reasoning-abort
    // Continue walls must stay sticky across read-only tool spam or the
    // model can reason-abort → read → reset forever without mutating.
    state.truncationRecoveriesUsed = 0;
  }

  if (recovery.kind === "reasoning_abort") {
    if (recovery.countReasoningAbort) {
      state.reasoningAbortRecoveriesUsed += 1;
    }
    reasonCodes.push("reasoning_progress_budget_exceeded");
    if (!recovery.shouldRecover) {
      // Soft recoveries exhausted — ask the host to Continue rather than
      // thrashing more reasoning-only turns.
      return done(
        offerContinue(
          mutationNeeded ? "unfulfilled_execute" : "exploration_stall",
          mutationNeeded && changedFiles.length === 0
            ? readonlyThrashPartialAnswer({
                hasPlan: planDraftedThisRun,
                fileReadCalls: loopFileReads.calls,
              })
            : turnContent || answer,
        ),
      );
    }

    warnings.push(truncationWarningMessage({ reasoningBudgetExceeded: true }));
    reasonCodes.push("model_completed");
    messages.push({
      role: "assistant",
      content: turnContent || "(reasoning only — no tools or answer)",
    });
    if (recovery.message) {
      messages.push({ role: "user", content: recovery.message });
    }

    if (mutationNeeded && changedFiles.length === 0 && !gitWriteSucceeded) {
      const early = applyReasoningAbortMutatePressure({
        messages,
        reasonCodes,
        warnings,
        seedTrusted,
        stepReadonlyTurnsBeforeGate,
        readonlyTurnsBeforeMutationNudge,
        mutateReadinessBudget,
        evaluateStepReadiness,
        planDraftedThisRun,
        vcsHistoryRewrite,
        loopFileReads,
        thresholds,
        changedFiles,
        gitWriteSucceeded,
        taskListRef,
        evidence,
        runtime,
        bus,
        runId,
        offerContinue,
        state,
      });
      if (early) {
        return done(early);
      }
    }
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
      "reasoning_progress_budget_exceeded",
    ]);
    return cont();
  }

  if (
    recovery.shouldRecover &&
    (recovery.kind === "text_continuation" || recovery.kind === "tool_call")
  ) {
    state.truncationRecoveriesUsed += 1;
    reasonCodes.push("output_truncation_recovered");
    warnings.push(truncationWarningMessage({}));
    messages.push({
      role: "assistant",
      content: turnContent,
      ...(toolCalls.length > 0 ? { toolCalls: [...toolCalls] } : {}),
    });
    if (recovery.message) {
      messages.push({ role: "user", content: recovery.message });
    }
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
      "output_truncated",
      "output_truncation_recovered",
    ]);
    return cont();
  }

  return undefined;
}
