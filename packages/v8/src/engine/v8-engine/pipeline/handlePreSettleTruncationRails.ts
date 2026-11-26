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
import {
  readonlyThrashPartialAnswer,
  shouldEscalateReadonlyThrashToContinue,
  softMutationNudgeMessage,
} from "../modules/mutation-nudge";
import {
  buildEvidenceRecoveryMessage,
  buildStepEvidenceGateMessage,
  buildStepPatchRequiredMessage,
  decideMutateEvidenceAction,
  resolveMutateLockAllowTargetedReads,
  type MutateReadinessBudget,
  type evaluateActiveStepMutateReadiness,
} from "../modules/mutate-readiness";
import type { OfferContinueFn } from "./createOfferContinue";
import { finishEvidenceRailExhausted } from "./modelLoopSupport";
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

function applyReasoningAbortMutatePressure(params: {
  messages: ModelMessage[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  seedTrusted: boolean;
  stepReadonlyTurnsBeforeGate: number;
  readonlyTurnsBeforeMutationNudge: number;
  mutateReadinessBudget: MutateReadinessBudget;
  evaluateStepReadiness: () => ReturnType<typeof evaluateActiveStepMutateReadiness>;
  planDraftedThisRun: boolean;
  vcsHistoryRewrite: boolean;
  loopFileReads: LoopFileReadTracker;
  thresholds: { maxSoftMutationNudgesBeforeContinue: number };
  changedFiles: string[];
  gitWriteSucceeded: boolean;
  taskListRef: TaskListRef;
  evidence: RunEvidence | undefined;
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  offerContinue: OfferContinueFn;
  state: PreSettleRailsState;
}): ToolLoopOutcome | undefined {
  const {
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
  } = params;

  const activeStep = taskListRef.current?.items.find(
    (item) => item.status === "active",
  );
  if (activeStep?.id !== state.lastActiveStepId) {
    state.lastActiveStepId = activeStep?.id;
    state.readonlyTurnsOnActiveStep = 0;
    state.evidenceGateNudges = 0;
    state.evidenceRecoveryUsed = false;
  }
  state.readOnlyTurnsWithoutMutation += 1;
  state.readonlyTurnsOnActiveStep += 1;
  const gateTurns = Math.min(
    stepReadonlyTurnsBeforeGate,
    readonlyTurnsBeforeMutationNudge,
  );
  if (state.readonlyTurnsOnActiveStep < gateTurns) {
    return undefined;
  }

  const readiness = evaluateStepReadiness();
  const evidenceAction = decideMutateEvidenceAction({
    readiness,
    seedTrusted,
    evidenceGateNudges: state.evidenceGateNudges,
    maxEvidenceGateNudges:
      mutateReadinessBudget.maxEvidenceGateNudgesBeforePatchDemand,
    recoveryAlreadyUsed: state.evidenceRecoveryUsed,
    maxRecoveryPaths: mutateReadinessBudget.evidenceRecoveryMaxPaths,
  });

  if (evidenceAction.kind === "EVIDENCE_GATE") {
    state.evidenceGateNudges += 1;
    reasonCodes.push("step_mutate_readiness_gated", "step_mutate_lock_armed");
    state.awaitingMutateOnly = true;
    state.mutateLockAllowTargetedReads = resolveMutateLockAllowTargetedReads({
      readinessReady: false,
      evidenceGateActive: true,
    });
    messages.push({
      role: "user",
      content: buildStepEvidenceGateMessage(readiness),
    });
  } else if (evidenceAction.kind === "RECOVERY_REQUIRED") {
    state.evidenceRecoveryUsed = true;
    state.evidenceGateNudges = 0;
    reasonCodes.push(
      "evidence_recovery_armed",
      "step_mutate_readiness_gated",
      "step_mutate_lock_armed",
    );
    state.awaitingMutateOnly = true;
    state.mutateLockAllowTargetedReads = resolveMutateLockAllowTargetedReads({
      readinessReady: false,
      evidenceGateActive: true,
    });
    messages.push({
      role: "user",
      content: buildEvidenceRecoveryMessage({
        paths: evidenceAction.recoveryPaths ?? evidenceAction.missingPaths,
        recoveryTurns: mutateReadinessBudget.evidenceRecoveryTurns,
      }),
    });
  } else if (evidenceAction.kind === "INSUFFICIENT_EVIDENCE") {
    if (evidenceAction.reason === "weak_seed") {
      state.softMutationNudges += 1;
      reasonCodes.push("execution_seed_weak", "soft_mutation_nudged");
      warnings.push(
        "No trusted execution seed yet — not demanding apply_patch. Establish a file path from diagnostics or an explicit cite.",
      );
      if (
        shouldEscalateReadonlyThrashToContinue({
          softMutationNudges: state.softMutationNudges,
          maxSoftMutationNudgesBeforeContinue:
            thresholds.maxSoftMutationNudgesBeforeContinue,
          changedFileCount: changedFiles.length,
          gitWriteSucceeded,
        })
      ) {
        reasonCodes.push("readonly_thrash_continue");
        return offerContinue(
          "evidence_clarify",
          "No trusted file seed yet, so no workspace edits were applied. Continue with an explicit path or stop here.",
        );
      }
    } else {
      return finishEvidenceRailExhausted({
        reason:
          evidenceAction.reason === "recovery_exhausted"
            ? "recovery_exhausted"
            : "miss_not_local",
        reasonCodes,
        warnings,
        runtime,
        bus,
        runId,
        evidence,
        budget: mutateReadinessBudget,
        nudgesUsed: state.evidenceGateNudges,
        recoveryUsed: state.evidenceRecoveryUsed,
        readonlyTurnsOnStep: gateTurns,
      });
    }
  } else {
    state.softMutationNudges += 1;
    reasonCodes.push("step_mutate_patch_required", "step_mutate_lock_armed");
    state.awaitingMutateOnly = true;
    state.mutateLockAllowTargetedReads = resolveMutateLockAllowTargetedReads({
      readinessReady: true,
      evidenceGateActive: false,
    });
    messages.push({
      role: "user",
      content:
        readiness.activeItemId || readiness.writePaths.length > 0
          ? buildStepPatchRequiredMessage(readiness)
          : softMutationNudgeMessage(gateTurns, {
              vcsHistoryRewrite,
              hasPlan: planDraftedThisRun,
            }),
    });
    if (
      shouldEscalateReadonlyThrashToContinue({
        softMutationNudges: state.softMutationNudges,
        maxSoftMutationNudgesBeforeContinue:
          thresholds.maxSoftMutationNudgesBeforeContinue,
        changedFileCount: changedFiles.length,
        gitWriteSucceeded,
      })
    ) {
      reasonCodes.push("readonly_thrash_continue");
      return offerContinue(
        "unfulfilled_execute",
        readonlyThrashPartialAnswer({
          hasPlan: planDraftedThisRun,
          fileReadCalls: loopFileReads.calls,
        }),
      );
    }
  }
  state.readonlyTurnsOnActiveStep = 0;
  state.readOnlyTurnsWithoutMutation = 0;
  return undefined;
}
