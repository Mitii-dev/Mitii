/**
 * After-settle mutate / readonly rails (change-impact, rejected mutation, evidence gate).
 */
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import type { EventBus } from "../internal/EventBus";
import type { TaskListRef } from "../internal/taskListRuntime";
import { changeImpactRetryPatchMessage } from "../modules/mutation-nudge";
import type {
  MutateReadinessBudget,
  evaluateActiveStepMutateReadiness,
} from "../modules/mutate-readiness";
import { buildRejectedMutationRecoveryMessage } from "../modules/rejected-mutation";
import type { OfferContinueFn } from "./createOfferContinue";
import type { SettleToolsResult } from "./settleTools";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type {
  AdvanceAfterToolSettleResult,
  AfterToolSettleState,
} from "./advanceAfterToolSettleTypes";
import { applyAfterSettleReadonlyEvidenceRails } from "./advanceAfterToolSettleReadonlyEvidence";

export function applyAfterToolSettleMutateRails(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  settled: Extract<SettleToolsResult, { kind: "continue" }>;
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
  changeImpactGate: {
    required: boolean;
    satisfied: boolean;
    lastImpactAffectedFiles?: string[];
    lastWidenVerification?: boolean;
  };
  evaluateStepReadiness: () => ReturnType<typeof evaluateActiveStepMutateReadiness>;
  loopFileReads: LoopFileReadTracker;
  thresholds: {
    maxRejectedMutationRecoveries: number;
    preferredBatchSize: number;
    maxSoftMutationNudgesBeforeContinue: number;
  };
  budgetCanStartModelCall: boolean;
  changedFiles: string[];
  state: AfterToolSettleState;
  done: (outcome: ToolLoopOutcome) => AdvanceAfterToolSettleResult;
  offerContinue: OfferContinueFn;
}): AdvanceAfterToolSettleResult | undefined {
  const {
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
    budgetCanStartModelCall,
    changedFiles,
    state,
    done,
    offerContinue,
  } = params;

  const decision = state.decision;

  if (settled.stats.succeededMutating || settled.stats.succeededGitWrite) {
    if (settled.stats.succeededGitWrite) {
      state.gitWriteSucceeded = true;
    }
    state.readOnlyTurnsWithoutMutation = 0;
    state.readonlyTurnsOnActiveStep = 0;
    state.unfulfilledExecuteRecoveries = 0;
    state.rejectedMutationRecoveries = 0;
    state.softMutationNudges = 0;
    state.evidenceGateNudges = 0;
    state.reasoningAbortRecoveriesUsed = 0;
    state.awaitingMutateOnly = false;
    state.mutateLockAllowTargetedReads = true;
    state.consecutiveSameToolTurns = 0;
    state.lastUniformToolName = undefined;
    return undefined;
  }

  if (
    mutationNeeded &&
    changedFiles.length === 0 &&
    !state.gitWriteSucceeded &&
    changeImpactGate.required &&
    changeImpactGate.satisfied &&
    toolCalls.some(
      (call) =>
        call.name === "analyze_change_impact" ||
        call.name === "plan_check_change_impact",
    )
  ) {
    // Gate just satisfied (or already was): demand the withheld patch this
    // turn — do not count this as readonly thrash / Continue.
    state.softMutationNudges = 0;
    state.readOnlyTurnsWithoutMutation = 0;
    state.readonlyTurnsOnActiveStep = 0;
    state.awaitingMutateOnly = true;
    state.mutateLockAllowTargetedReads = false;
    reasonCodes.push("step_mutate_patch_required", "step_mutate_lock_armed");
    warnings.push(
      "Change impact satisfied; mutate lock demanding apply_patch retry.",
    );
    runtime.emit(bus, {
      type: "warning",
      runId,
      message:
        "Mutate lock: discovery stripped; call apply_patch now (targeted reads off). Edits are not done until it lands.",
      at: runtime.isoNow(),
    });
    messages.push({
      role: "user",
      content: changeImpactRetryPatchMessage(),
    });
    return undefined;
  }

  if (
    mutationNeeded &&
    changedFiles.length === 0 &&
    !state.gitWriteSucceeded &&
    settled.stats.rejectedMutation &&
    state.rejectedMutationRecoveries < thresholds.maxRejectedMutationRecoveries &&
    budgetCanStartModelCall
  ) {
    state.rejectedMutationRecoveries += 1;
    const rejected = settled.stats.rejectedMutation;
    const maxTargetedDiscoveryToolCalls =
      decision.toolGrant.mutationBudget?.maxUniqueFilesPerCall ??
      thresholds.preferredBatchSize;
    reasonCodes.push("tool_failed");
    warnings.push(
      `Mutation tool ${rejected.toolName} ${rejected.status}; requesting a corrected edit.`,
    );
    messages.push({
      role: "user",
      content: buildRejectedMutationRecoveryMessage({
        ...rejected,
        maxTargetedDiscoveryToolCalls,
        defaultPreferredBatchSize: thresholds.preferredBatchSize,
      }),
    });
    return undefined;
  }

  return applyAfterSettleReadonlyEvidenceRails({
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
  });
}
