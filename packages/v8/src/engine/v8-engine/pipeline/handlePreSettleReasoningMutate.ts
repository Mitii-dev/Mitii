/**
 * Apply mutate-pressure after a recoverable reasoning abort with no mutations yet.
 */
import type { ModelMessage } from "../../../modules/model-gateway";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import type { EventBus } from "../internal/EventBus";
import type { TaskListRef } from "../internal/taskListRuntime";
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
import type { PreSettleRailsState } from "./handlePreSettleTurnRailsTypes";

export function applyReasoningAbortMutatePressure(params: {
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
