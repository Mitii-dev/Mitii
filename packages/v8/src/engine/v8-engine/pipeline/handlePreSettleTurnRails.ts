import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import { EventBus } from "../internal/EventBus";
import type { TaskListRef } from "../internal/taskListRuntime";
import {
  forceFinalToolLoopMessage,
  type ToolLoopGuard,
} from "../modules/tool-loop-guard";
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
  evaluateActiveStepMutateReadiness,
  resolveMutateLockAllowTargetedReads,
  type MutateReadinessBudget,
} from "../modules/mutate-readiness";
import { finishEvidenceRailExhausted } from "./modelLoopSupport";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";

export type PreSettleRailsState = {
  softNudgeAfterSettle: boolean;
  forceFinalOnly: boolean;
  truncationRecoveriesUsed: number;
  reasoningAbortRecoveriesUsed: number;
  readOnlyTurnsWithoutMutation: number;
  readonlyTurnsOnActiveStep: number;
  lastActiveStepId: string | undefined;
  evidenceGateNudges: number;
  evidenceRecoveryUsed: boolean;
  awaitingMutateOnly: boolean;
  mutateLockAllowTargetedReads: boolean;
  softMutationNudges: number;
};

export type PreSettleRailsResult = {
  state: PreSettleRailsState;
} & (
  | { kind: "continue" }
  | { kind: "done"; outcome: ToolLoopOutcome }
  | { kind: "proceed" }
);

/** Tool-loop guard + truncation/reasoning-abort rails before settle. */
export function handlePreSettleTurnRails(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  turnContent: string;
  finishReason: string | undefined;
  reasoningBudgetExceeded: boolean;
  toolCalls: readonly ModelToolCall[];
  discardedCount: number;
  messages: ModelMessage[];
  toolLoopGuard: ToolLoopGuard;
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
  offerContinue: (
    wallReason:
      | "exploration_stall"
      | "unfulfilled_execute"
      | "budget_exhausted"
      | "evidence_clarify"
      | "provider_unavailable",
    partialAnswer: string,
  ) => ToolLoopOutcome;
  state: Omit<PreSettleRailsState, "softNudgeAfterSettle">;
}): PreSettleRailsResult {
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

  let softNudgeAfterSettle = false;
  let {
    forceFinalOnly,
    truncationRecoveriesUsed,
    reasoningAbortRecoveriesUsed,
    readOnlyTurnsWithoutMutation,
    readonlyTurnsOnActiveStep,
    lastActiveStepId,
    evidenceGateNudges,
    evidenceRecoveryUsed,
    awaitingMutateOnly,
    mutateLockAllowTargetedReads,
    softMutationNudges,
  } = params.state;

  const snapshot = (): PreSettleRailsState => ({
    softNudgeAfterSettle,
    forceFinalOnly,
    truncationRecoveriesUsed,
    reasoningAbortRecoveriesUsed,
    readOnlyTurnsWithoutMutation,
    readonlyTurnsOnActiveStep,
    lastActiveStepId,
    evidenceGateNudges,
    evidenceRecoveryUsed,
    awaitingMutateOnly,
    mutateLockAllowTargetedReads,
    softMutationNudges,
  });
  const cont = (): PreSettleRailsResult => ({ kind: "continue", state: snapshot() });
  const done = (outcome: ToolLoopOutcome): PreSettleRailsResult => ({
    kind: "done",
    outcome,
    state: snapshot(),
  });
  const proceed = (): PreSettleRailsResult => ({ kind: "proceed", state: snapshot() });

  const turn = {
    content: turnContent,
    finishReason,
    reasoningBudgetExceeded,
  };

if (toolCalls.length > 0) {
  const callDecision = toolLoopGuard.observeCalls(
    toolCalls.map((call) => ({
      name: call.name,
      arguments: call.arguments,
    })),
  );

  if (callDecision.type === "reject") {
    warnings.push(
      `Identical tool batch rejected (${callDecision.violationCount} after force-final).`,
    );
    messages.push({
      role: "assistant",
      content: turn.content,
      toolCalls,
    });
    messages.push({
      role: "user",
      content: forceFinalToolLoopMessage(callDecision.violationCount),
    });
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
    ]);
    if (callDecision.exhausted) {
      return done(offerContinue("exploration_stall", turn.content || answer));
    }
    forceFinalOnly = true;
    return cont();
  }

  if (callDecision.type === "force_final") {
    warnings.push(
      `Tool loop force-final after ${callDecision.repeatCount} identical batches.`,
    );
    forceFinalOnly = true;
    messages.push({
      role: "assistant",
      content: turn.content,
      toolCalls,
    });
    messages.push({
      role: "user",
      content: forceFinalToolLoopMessage(callDecision.repeatCount),
    });
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
    ]);
    return cont();
  }

  if (callDecision.type === "soft") {
    softNudgeAfterSettle = true;
    warnings.push(
      `Soft tool-loop nudge after ${callDecision.repeatCount} identical batches.`,
    );
  }
}

const recovery = decideTruncationRecovery({
  finishReason: turn.finishReason,
  reasoningBudgetExceeded: turn.reasoningBudgetExceeded === true,
  hasToolCalls: toolCalls.length > 0,
  incompleteToolCalls: discardedCount > 0 && toolCalls.length === 0,
  truncationRecoveriesUsed,
  maxTruncationRecoveries: thresholds.maxTruncationRecoveries,
  reasoningAbortRecoveriesUsed,
  maxReasoningAbortRecoveries: thresholds.maxReasoningAbortRecoveries,
  requireMutation: mutationNeeded,
});

if (recovery.resetCounter) {
  // Tool progress clears provider length recoveries only. Reasoning-abort
  // Continue walls must stay sticky across read-only tool spam or the
  // model can reason-abort → read → reset forever without mutating.
  truncationRecoveriesUsed = 0;
}

if (recovery.kind === "reasoning_abort") {
  if (recovery.countReasoningAbort) {
    reasoningAbortRecoveriesUsed += 1;
  }
  reasonCodes.push("reasoning_progress_budget_exceeded");
  if (recovery.shouldRecover) {
    warnings.push(
      truncationWarningMessage({ reasoningBudgetExceeded: true }),
    );
    reasonCodes.push("model_completed");
    messages.push({
      role: "assistant",
      content: turn.content || "(reasoning only — no tools or answer)",
    });
    if (recovery.message) {
      messages.push({ role: "user", content: recovery.message });
    }
    // Count reasoning-only burns toward per-step evidence→patch pressure.
    if (mutationNeeded && changedFiles.length === 0 && !gitWriteSucceeded) {
      const activeStep = taskListRef.current?.items.find(
        (item) => item.status === "active",
      );
      if (activeStep?.id !== lastActiveStepId) {
        lastActiveStepId = activeStep?.id;
        readonlyTurnsOnActiveStep = 0;
        evidenceGateNudges = 0;
        evidenceRecoveryUsed = false;
      }
      readOnlyTurnsWithoutMutation += 1;
      readonlyTurnsOnActiveStep += 1;
      const gateTurns = Math.min(
        stepReadonlyTurnsBeforeGate,
        readonlyTurnsBeforeMutationNudge,
      );
      if (readonlyTurnsOnActiveStep >= gateTurns) {
        const readiness = evaluateStepReadiness();
        const evidenceAction = decideMutateEvidenceAction({
          readiness,
          seedTrusted,
          evidenceGateNudges,
          maxEvidenceGateNudges:
            mutateReadinessBudget.maxEvidenceGateNudgesBeforePatchDemand,
          recoveryAlreadyUsed: evidenceRecoveryUsed,
          maxRecoveryPaths: mutateReadinessBudget.evidenceRecoveryMaxPaths,
        });
        if (evidenceAction.kind === "EVIDENCE_GATE") {
          evidenceGateNudges += 1;
          reasonCodes.push(
            "step_mutate_readiness_gated",
            "step_mutate_lock_armed",
          );
          awaitingMutateOnly = true;
          mutateLockAllowTargetedReads = resolveMutateLockAllowTargetedReads({
            readinessReady: false,
            evidenceGateActive: true,
          });
          messages.push({
            role: "user",
            content: buildStepEvidenceGateMessage(readiness),
          });
        } else if (evidenceAction.kind === "RECOVERY_REQUIRED") {
          evidenceRecoveryUsed = true;
          evidenceGateNudges = 0;
          reasonCodes.push(
            "evidence_recovery_armed",
            "step_mutate_readiness_gated",
            "step_mutate_lock_armed",
          );
          awaitingMutateOnly = true;
          mutateLockAllowTargetedReads =
            resolveMutateLockAllowTargetedReads({
              readinessReady: false,
              evidenceGateActive: true,
            });
          messages.push({
            role: "user",
            content: buildEvidenceRecoveryMessage({
              paths:
                evidenceAction.recoveryPaths ?? evidenceAction.missingPaths,
              recoveryTurns: mutateReadinessBudget.evidenceRecoveryTurns,
            }),
          });
        } else if (evidenceAction.kind === "INSUFFICIENT_EVIDENCE") {
          if (evidenceAction.reason === "weak_seed") {
            softMutationNudges += 1;
            reasonCodes.push("execution_seed_weak", "soft_mutation_nudged");
            warnings.push(
              "No trusted execution seed yet — not demanding apply_patch. Establish a file path from diagnostics or an explicit cite.",
            );
            if (
              shouldEscalateReadonlyThrashToContinue({
                softMutationNudges,
                maxSoftMutationNudgesBeforeContinue:
                  thresholds.maxSoftMutationNudgesBeforeContinue,
                changedFileCount: changedFiles.length,
                gitWriteSucceeded,
              })
            ) {
              reasonCodes.push("readonly_thrash_continue");
              return done(offerContinue(
                "evidence_clarify",
                "No trusted file seed yet, so no workspace edits were applied. Continue with an explicit path or stop here.",
              ));
            }
          } else {
            return done(finishEvidenceRailExhausted({
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
              nudgesUsed: evidenceGateNudges,
              recoveryUsed: evidenceRecoveryUsed,
              readonlyTurnsOnStep: gateTurns,
            }));
          }
        } else {
          softMutationNudges += 1;
          reasonCodes.push(
            "step_mutate_patch_required",
            "step_mutate_lock_armed",
          );
          awaitingMutateOnly = true;
          mutateLockAllowTargetedReads =
            resolveMutateLockAllowTargetedReads({
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
              softMutationNudges,
              maxSoftMutationNudgesBeforeContinue:
                thresholds.maxSoftMutationNudgesBeforeContinue,
              changedFileCount: changedFiles.length,
              gitWriteSucceeded,
            })
          ) {
            reasonCodes.push("readonly_thrash_continue");
            return done(offerContinue(
              "unfulfilled_execute",
              readonlyThrashPartialAnswer({
                hasPlan: planDraftedThisRun,
                fileReadCalls: loopFileReads.calls,
              }),
            ));
          }
        }
        readonlyTurnsOnActiveStep = 0;
        readOnlyTurnsWithoutMutation = 0;
      }
    }
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
      "reasoning_progress_budget_exceeded",
    ]);
    return cont();
  }
  // Soft recoveries exhausted — ask the host to Continue rather than
  // thrashing more reasoning-only turns.
  return done(offerContinue(
    mutationNeeded ? "unfulfilled_execute" : "exploration_stall",
    mutationNeeded && changedFiles.length === 0
      ? readonlyThrashPartialAnswer({
          hasPlan: planDraftedThisRun,
          fileReadCalls: loopFileReads.calls,
        })
      : turn.content || answer,
  ));
}

if (
  recovery.shouldRecover &&
  (recovery.kind === "text_continuation" || recovery.kind === "tool_call")
) {
  truncationRecoveriesUsed += 1;
  reasonCodes.push("output_truncation_recovered");
  warnings.push(truncationWarningMessage({}));
  messages.push({
    role: "assistant",
    content: turn.content,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
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


  return proceed();
}
