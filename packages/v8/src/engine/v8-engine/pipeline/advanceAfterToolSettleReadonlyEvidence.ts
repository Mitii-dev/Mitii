/**
 * Readonly thrash → evidence gate / recovery / patch demand after tool settle.
 */
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import type { EventBus } from "../internal/EventBus";
import type { TaskListRef } from "../internal/taskListRuntime";
import {
  batchIsReadonlyTools,
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
  AdvanceAfterToolSettleResult,
  AfterToolSettleState,
} from "./advanceAfterToolSettleTypes";

export function applyAfterSettleReadonlyEvidenceRails(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  toolCalls: readonly ModelToolCall[];
  messages: ModelMessage[];
  taskListRef: TaskListRef;
  evidence: RunEvidence | undefined;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  mutationNeeded: boolean;
  vcsHistoryRewrite: boolean;
  planDraftedThisRun: boolean;
  seedTrusted: boolean;
  stepReadonlyTurnsBeforeGate: number;
  readonlyTurnsBeforeMutationNudge: number;
  mutateReadinessBudget: MutateReadinessBudget;
  evaluateStepReadiness: () => ReturnType<typeof evaluateActiveStepMutateReadiness>;
  loopFileReads: LoopFileReadTracker;
  thresholds: {
    maxSoftMutationNudgesBeforeContinue: number;
  };
  changedFiles: string[];
  state: AfterToolSettleState;
  done: (outcome: ToolLoopOutcome) => AdvanceAfterToolSettleResult;
  offerContinue: OfferContinueFn;
}): AdvanceAfterToolSettleResult | undefined {
  const {
    runtime,
    bus,
    runId,
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
    evaluateStepReadiness,
    loopFileReads,
    thresholds,
    changedFiles,
    state,
    done,
    offerContinue,
  } = params;

  if (!(mutationNeeded && batchIsReadonlyTools(toolCalls))) {
    return undefined;
  }

  const activeStep = taskListRef.current?.items.find(
    (item) => item.status === "active",
  );
  const activeStepId = activeStep?.id;
  if (activeStepId !== state.lastActiveStepId) {
    state.lastActiveStepId = activeStepId;
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
    const gateMessage = buildStepEvidenceGateMessage(readiness);
    warnings.push(
      `Step evidence gate: ${readiness.missingPaths.length} path(s) still needed before patch.`,
    );
    runtime.emit(bus, {
      type: "warning",
      runId,
      message: `Step evidence gate for "${readiness.activeTitle ?? readiness.activeItemId ?? "active step"}"; discovery stripped — targeted reads then patch. Edits are not done.`,
      at: runtime.isoNow(),
    });
    messages.push({ role: "user", content: gateMessage });
    state.readonlyTurnsOnActiveStep = 0;
    state.readOnlyTurnsWithoutMutation = 0;
    return undefined;
  }

  if (evidenceAction.kind === "RECOVERY_REQUIRED") {
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
    const recoveryPaths =
      evidenceAction.recoveryPaths ?? evidenceAction.missingPaths;
    warnings.push(
      `Evidence recovery: ${recoveryPaths.length} local path(s); no open-world search.`,
    );
    messages.push({
      role: "user",
      content: buildEvidenceRecoveryMessage({
        paths: recoveryPaths,
        recoveryTurns: mutateReadinessBudget.evidenceRecoveryTurns,
      }),
    });
    state.readonlyTurnsOnActiveStep = 0;
    state.readOnlyTurnsWithoutMutation = 0;
    return undefined;
  }

  if (evidenceAction.kind === "INSUFFICIENT_EVIDENCE") {
    if (evidenceAction.reason === "weak_seed") {
      state.softMutationNudges += 1;
      reasonCodes.push("execution_seed_weak", "soft_mutation_nudged");
      warnings.push(
        "No trusted execution seed yet — not demanding apply_patch after readonly thrash.",
      );
      state.readonlyTurnsOnActiveStep = 0;
      state.readOnlyTurnsWithoutMutation = 0;
      if (
        shouldEscalateReadonlyThrashToContinue({
          softMutationNudges: state.softMutationNudges,
          maxSoftMutationNudgesBeforeContinue:
            thresholds.maxSoftMutationNudgesBeforeContinue,
          changedFileCount: changedFiles.length,
          gitWriteSucceeded: state.gitWriteSucceeded,
        })
      ) {
        reasonCodes.push("readonly_thrash_continue");
        return done(
          offerContinue(
            "evidence_clarify",
            "No trusted file seed yet, so no workspace edits were applied. Continue with an explicit path or stop here.",
          ),
        );
      }
      return undefined;
    }
    return done(
      finishEvidenceRailExhausted({
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
        readonlyTurnsOnStep: state.readonlyTurnsOnActiveStep || gateTurns,
      }),
    );
  }

  // PATCH_READY
  state.softMutationNudges += 1;
  reasonCodes.push("step_mutate_patch_required", "step_mutate_lock_armed");
  state.awaitingMutateOnly = true;
  state.mutateLockAllowTargetedReads = resolveMutateLockAllowTargetedReads({
    readinessReady: true,
    evidenceGateActive: false,
  });
  const patchMessage =
    readiness.activeItemId || readiness.writePaths.length > 0
      ? buildStepPatchRequiredMessage(readiness)
      : softMutationNudgeMessage(state.readonlyTurnsOnActiveStep || gateTurns, {
          vcsHistoryRewrite,
          hasPlan: planDraftedThisRun,
        });
  warnings.push(
    `Step patch demand after ${gateTurns} read-only turns on active step (mutate lock armed).`,
  );
  runtime.emit(bus, {
    type: "warning",
    runId,
    message:
      "Mutate lock: discovery stripped; call apply_patch now (targeted reads off). Edits are not done until it lands.",
    at: runtime.isoNow(),
  });
  messages.push({ role: "user", content: patchMessage });
  state.readonlyTurnsOnActiveStep = 0;
  state.readOnlyTurnsWithoutMutation = 0;

  if (
    shouldEscalateReadonlyThrashToContinue({
      softMutationNudges: state.softMutationNudges,
      maxSoftMutationNudgesBeforeContinue:
        thresholds.maxSoftMutationNudgesBeforeContinue,
      changedFileCount: changedFiles.length,
      gitWriteSucceeded: state.gitWriteSucceeded,
    })
  ) {
    reasonCodes.push("readonly_thrash_continue");
    warnings.push(
      "Read-only thrash after soft mutation nudges; offering Continue without claiming edits are done.",
    );
    return done(
      offerContinue(
        "unfulfilled_execute",
        readonlyThrashPartialAnswer({
          hasPlan: planDraftedThisRun,
          fileReadCalls: loopFileReads.calls,
        }),
      ),
    );
  }
  return undefined;
}
