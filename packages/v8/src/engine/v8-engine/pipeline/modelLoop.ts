import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import { createLoopFileReadTracker } from "../actions";
import { ReadLedger } from "../internal/ReadLedger";
import type { ContextEpoch } from "../internal/context-epoch";
import { InMemorySessionHistoryArchive } from "../internal/session-history";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type { SteeringCriticMode } from "../legacy/steeringFlags";

import {
  resolveV8LoopPolicyThresholds,
} from "../policy/bands";
import { ToolLoopGuard } from "../modules/tool-loop-guard";
import {
  hasPlanDraftedThisRun,
  requiresMutation,
  resolveReadonlyTurnsBeforeMutationNudge,
} from "../modules/mutation-nudge";
import {
  evaluateActiveStepMutateReadiness,
  resolveMutateReadinessBudget,
  resolveStepReadonlyTurnsBeforeGate,
} from "../modules/mutate-readiness";
import { isExecutionSeedTrusted } from "../modules/execution-seed";
import { settleToolBatch } from "./settleTools";

import { pickV8ThresholdOverrides } from "./modelLoopSupport";
import { createOfferContinue } from "./createOfferContinue";
import { handleWallTimeDeadline } from "./handleWallTimeDeadline";
import { runModelLoopModelTurn } from "./runModelLoopModelTurn";
import { finishModelLoopAnswerTurn } from "./finishModelLoopAnswerTurn";
import { applyMutationCriticTurn } from "./applyMutationCriticTurn";
import { advanceAfterToolSettle } from "./advanceAfterToolSettle";
import { handlePreSettleTurnRails } from "./handlePreSettleTurnRails";
import type { V8ModelLoopParams } from "./modelLoopTypes";

export type { V8ModelLoopParams } from "./modelLoopTypes";

/**
 * Thin model/tool loop with discipline:
 * prepareTurn (compaction/working set), ToolLoopGuard, soft mutation nudge
 * (no evidence spend), rejected-mutation recovery, truncation/reasoning rails.
 */
export async function runV8ModelLoop(
  runtime: AgentEngineRuntime,
  params: V8ModelLoopParams,
): Promise<ToolLoopOutcome> {
  const {
    runId,
    requestId,
    interactionMode,
    llm,
    request,
    messages,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    toolCache,
    changedFiles,
    mutationCheckpointIds,
    dirtyPaths,
    pinnedState,
    workspaceRoot,
    taskListRef,
    evidence,
    establishedFacts,
    windowPolicy,
  } = params;

  let decision = params.decision;
  let answer = "";
  let truncationRecoveriesUsed = 0;
  let reasoningAbortRecoveriesUsed = 0;
  let readOnlyTurnsWithoutMutation = 0;
  let unfulfilledExecuteRecoveries = 0;
  let rejectedMutationRecoveries = 0;
  let emittedLoopPressureWarning = false;
  let emittedLoopCompactionWarning = false;
  let lastPromptCacheClass: PromptCacheClass | undefined;
  let contextEpoch: ContextEpoch | undefined =
    runtime.contextEpochs.get(runId);
  const sessionHistoryArchive = new InMemorySessionHistoryArchive();
  const logVerbosity: AgentLogVerbosity = params.logVerbosity ?? "standard";
  let memoryFacts = params.memoryFacts
    ? [...params.memoryFacts]
    : undefined;
  const continueOverrideCount = params.continueOverrideCount ?? 0;
  let forceFinalOnly = false;
  let awaitingAnswerOnly = false;
  let awaitingMutateOnly = params.armMutateLockOnStart === true;
  let mutateLockAllowTargetedReads = !(params.armMutateLockOnStart === true);
  let consecutiveSameToolTurns = 0;
  let lastUniformToolName: string | undefined;
  let diagnoseAnswerNudges = 0;
  let incompleteAnswerRecoveries = 0;
  let softMutationNudges = 0;
  let evidenceGateNudges = 0;
  let evidenceRecoveryUsed = false;
  let readonlyTurnsOnActiveStep = 0;
  let lastActiveStepId: string | undefined;
  const mutationNeeded = requiresMutation(decision);
  const vcsHistoryRewrite = decision.reasonCodes.includes("vcs_history_rewrite");
  let gitWriteSucceeded = false;
  let wallTimeNudged = false;
  const executionSeed = params.executionSeed;
  const seedTrusted = isExecutionSeedTrusted(executionSeed);
  const seedPaths = executionSeed?.paths ?? [];
  const readLedger = new ReadLedger();
  const thresholds = resolveV8LoopPolicyThresholds({
    contextWindowTokens: params.windowPolicy.contextWindowTokens,
    overrides: pickV8ThresholdOverrides(params.thresholdOverrides),
  }).thresholds;
  const planDraftedThisRun = hasPlanDraftedThisRun({
    planningDepth: decision.planningDepth,
    reasonCodes,
  });
  const taskSize =
    params.understanding?.taskAnalysis?.taskSize ??
    (planDraftedThisRun ? "medium" : "small");
  const mutateReadinessBudget = resolveMutateReadinessBudget(
    taskSize,
    params.windowPolicy.contextWindowTokens,
  );
  const stepReadonlyTurnsBeforeGate = resolveStepReadonlyTurnsBeforeGate({
    taskSize,
    hasPlan: planDraftedThisRun,
    maxReadOnlyTurnsBeforeMutationNudgeAfterPlan:
      thresholds.maxReadOnlyTurnsBeforeMutationNudgeAfterPlan,
    windowBandOrTokens: params.windowPolicy.contextWindowTokens,
    seedTrusted,
  });
  // Trusted seed: size×band bind envelope only (see resolveStepReadonlyTurnsBeforeGate).
  // Untrusted: soft-nudge threshold, tightened after a plan.
  const readonlyTurnsBeforeMutationNudge = seedTrusted
    ? stepReadonlyTurnsBeforeGate
    : resolveReadonlyTurnsBeforeMutationNudge({
        hasPlan: planDraftedThisRun,
        maxReadOnlyTurnsBeforeMutationNudge:
          thresholds.maxReadOnlyTurnsBeforeMutationNudge,
        maxReadOnlyTurnsBeforeMutationNudgeAfterPlan:
          thresholds.maxReadOnlyTurnsBeforeMutationNudgeAfterPlan,
      });
  const mustReadNudgeBudget = { remaining: thresholds.maxMustReadNudges };
  const changeImpactRecommended = decision.reasonCodes.includes(
    "change_impact_recommended",
  );
  const changeImpactAlreadyObserved = reasonCodes.includes(
    "change_impact_observed",
  );
  const changeImpactGate = {
    required:
      changeImpactRecommended &&
      decision.toolGrant.maximumWorkspaceEffect === "write",
    // Stay satisfied across Continue if analyze_change_impact already ran.
    satisfied:
      changeImpactAlreadyObserved ||
      !(
        changeImpactRecommended &&
        decision.toolGrant.maximumWorkspaceEffect === "write"
      ),
  };
  const changeImpactNudgeBudget = {
    remaining:
      changeImpactGate.required && !changeImpactGate.satisfied
        ? thresholds.maxChangeImpactNudges
        : 0,
  };
  const loopFileReads = createLoopFileReadTracker();
  const evaluateStepReadiness = () =>
    evaluateActiveStepMutateReadiness({
      taskList: taskListRef.current,
      loopFileReads,
      establishedFacts,
      maxEvidencePaths: mutateReadinessBudget.maxEvidencePaths,
      mutationRequired: mutationNeeded,
      seedPaths,
      seedTrusted,
    });
  const criticMode: SteeringCriticMode = params.criticMode ?? "off";
  const toolLoopGuard = new ToolLoopGuard({
    softIdenticalLimit: thresholds.toolLoopSoftIdentical,
    hardIdenticalLimit: thresholds.toolLoopHardIdentical,
    identicalCallAndResultLimit: thresholds.toolLoopIdenticalCallAndResult,
    forcedRejectLimit: thresholds.toolLoopForcedRejectLimit,
  });
  if (awaitingMutateOnly) {
    reasonCodes.push("step_mutate_lock_armed");
    warnings.push(
      "Mutate lock re-armed on Continue; discovery stripped until apply_patch lands.",
    );
  }

  const offerContinue = createOfferContinue({
    messages,
    toolCache,
    changedFiles,
    mutationCheckpointIds,
    getDecision: () => decision,
    continueOverrideCount,
    maxContinueOverrides: thresholds.maxContinueOverrides,
    getTaskList: () => taskListRef.current,
    mutationRequired: mutationNeeded,
    reasonCodes,
  });

  while (true) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }
    const wall = handleWallTimeDeadline({
      budget,
      mutationApplied: changedFiles.length > 0 || gitWriteSucceeded,
      mutationRequired: mutationNeeded,
      wallTimeNudged,
      answer,
      changedFiles,
      mutationCheckpointIds,
      messages,
      toolCache,
      decision,
      reasonCodes,
      warnings,
      offerContinue,
    });
    wallTimeNudged = wall.wallTimeNudged;
    if (wall.kind === "done") {
      return wall.outcome;
    }

    const modelTurn = await runModelLoopModelTurn({
      runtime,
      bus,
      runId,
      signal,
      llm,
      request,
      messages,
      budget,
      windowPolicy,
      taskListRef,
      decision,
      forceFinalOnly,
      awaitingAnswerOnly,
      awaitingMutateOnly,
      mutateLockAllowTargetedReads,
      toolLoopGuard,
      answer,
      reasonCodes,
      warnings,
      logVerbosity,
      lastPromptCacheClass,
      emittedLoopPressureWarning,
      emittedLoopCompactionWarning,
      contextEpoch,
      memoryFacts,
      memoryQuery: params.memoryQuery,
      memoryWorkspaceId: params.memoryWorkspaceId,
      memoryFileTargets: params.memoryFileTargets,
      establishedFacts,
      repoBuildStateBefore: params.repoBuildStateBefore,
      selectedSkillIds: params.selectedSkillIds,
      projectRuleIds: params.projectRuleIds,
      environmentIds: params.environmentIds,
      instructionBodies: params.instructionBodies,
      sessionHistoryArchive,
      maxReasoningCharsWithoutProgress:
        thresholds.maxReasoningCharsWithoutProgress,
      offerContinue,
    });
    if (modelTurn.kind === "cancelled") {
      return { kind: "cancelled" };
    }
    if (modelTurn.kind === "done") {
      return modelTurn.outcome;
    }
    memoryFacts = modelTurn.memoryFacts;
    emittedLoopPressureWarning = modelTurn.emittedLoopPressureWarning;
    emittedLoopCompactionWarning = modelTurn.emittedLoopCompactionWarning;
    lastPromptCacheClass = modelTurn.lastPromptCacheClass;
    contextEpoch = modelTurn.contextEpoch;
    const { turn, toolCalls, discardedCount, truncated } = modelTurn;

    let softNudgeAfterSettle = false;
    const preSettle = handlePreSettleTurnRails({
      runtime,
      bus,
      runId,
      turnContent: turn.content,
      finishReason: turn.finishReason,
      reasoningBudgetExceeded: turn.reasoningBudgetExceeded === true,
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
      thresholds: {
        maxTruncationRecoveries: thresholds.maxTruncationRecoveries,
        maxReasoningAbortRecoveries: thresholds.maxReasoningAbortRecoveries,
        maxSoftMutationNudgesBeforeContinue:
          thresholds.maxSoftMutationNudgesBeforeContinue,
      },
      offerContinue,
      state: {
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
      },
    });
    softNudgeAfterSettle = preSettle.state.softNudgeAfterSettle;
    forceFinalOnly = preSettle.state.forceFinalOnly;
    truncationRecoveriesUsed = preSettle.state.truncationRecoveriesUsed;
    reasoningAbortRecoveriesUsed = preSettle.state.reasoningAbortRecoveriesUsed;
    readOnlyTurnsWithoutMutation = preSettle.state.readOnlyTurnsWithoutMutation;
    readonlyTurnsOnActiveStep = preSettle.state.readonlyTurnsOnActiveStep;
    lastActiveStepId = preSettle.state.lastActiveStepId;
    evidenceGateNudges = preSettle.state.evidenceGateNudges;
    evidenceRecoveryUsed = preSettle.state.evidenceRecoveryUsed;
    awaitingMutateOnly = preSettle.state.awaitingMutateOnly;
    mutateLockAllowTargetedReads = preSettle.state.mutateLockAllowTargetedReads;
    softMutationNudges = preSettle.state.softMutationNudges;
    if (preSettle.kind === "done") {
      return preSettle.outcome;
    }
    if (preSettle.kind === "continue") {
      continue;
    }

    reasonCodes.push("model_completed");
    if (truncated && turn.reasoningBudgetExceeded !== true) {
      reasonCodes.push("output_truncated");
    }
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
      ...(truncated && turn.reasoningBudgetExceeded !== true
        ? (["output_truncated"] as const)
        : []),
    ]);

    if (toolCalls.length > 0) {
      truncationRecoveriesUsed = 0;

      const criticTurn = applyMutationCriticTurn({
        runtime,
        bus,
        runId,
        decision,
        toolCalls,
        turnContent: turn.content,
        messages,
        reasonCodes,
        warnings,
        criticMode,
        understanding: params.understanding,
      });
      decision = criticTurn.decision;
      if (criticTurn.kind === "continue") {
        continue;
      }

      const settled = await settleToolBatch({
        runtime,
        runId,
        requestId,
        interactionMode,
        bus,
        signal,
        decision,
        toolCalls,
        turnContent: turn.content,
        messages,
        toolCache,
        readLedger,
        budget,
        warnings,
        reasonCodes,
        dirtyPaths,
        pinnedState,
        workspaceRoot,
        changedFiles,
        mutationCheckpointIds,
        taskListRef,
        evidence,
        establishedFacts,
        windowPolicy,
        answer,
        toolLoopGuard,
        mustReadNudgeBudget,
        changeImpactGate,
        changeImpactNudgeBudget,
        loopFileReads,
        awaitingMutateOnly,
        mutateLockAllowTargetedReads,
      });
      if (settled.kind === "return") {
        return settled.outcome;
      }
      decision = settled.decision;

      const advanced = advanceAfterToolSettle({
        runtime,
        bus,
        runId,
        settled,
        softNudgeAfterSettle,
        toolCalls,
        turnContent: turn.content,
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
        thresholds: {
          toolLoopSoftIdentical: thresholds.toolLoopSoftIdentical,
          toolLoopIdenticalCallAndResult: thresholds.toolLoopIdenticalCallAndResult,
          maxRejectedMutationRecoveries: thresholds.maxRejectedMutationRecoveries,
          preferredBatchSize: thresholds.preferredBatchSize,
          maxSoftMutationNudgesBeforeContinue:
            thresholds.maxSoftMutationNudgesBeforeContinue,
          maxRepeatedReadonlyToolTurnsBeforeAnswerNudge:
            thresholds.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge,
          maxDiagnoseAnswerNudges: thresholds.maxDiagnoseAnswerNudges,
        },
        offerContinue,
        state: {
          decision,
          answer,
          gitWriteSucceeded,
          readOnlyTurnsWithoutMutation,
          readonlyTurnsOnActiveStep,
          unfulfilledExecuteRecoveries,
          rejectedMutationRecoveries,
          softMutationNudges,
          evidenceGateNudges,
          evidenceRecoveryUsed,
          reasoningAbortRecoveriesUsed,
          awaitingMutateOnly,
          mutateLockAllowTargetedReads,
          consecutiveSameToolTurns,
          lastUniformToolName,
          lastActiveStepId,
          awaitingAnswerOnly,
          forceFinalOnly,
          diagnoseAnswerNudges,
        },
      });
      decision = advanced.state.decision;
      answer = advanced.state.answer;
      gitWriteSucceeded = advanced.state.gitWriteSucceeded;
      readOnlyTurnsWithoutMutation = advanced.state.readOnlyTurnsWithoutMutation;
      readonlyTurnsOnActiveStep = advanced.state.readonlyTurnsOnActiveStep;
      unfulfilledExecuteRecoveries = advanced.state.unfulfilledExecuteRecoveries;
      rejectedMutationRecoveries = advanced.state.rejectedMutationRecoveries;
      softMutationNudges = advanced.state.softMutationNudges;
      evidenceGateNudges = advanced.state.evidenceGateNudges;
      evidenceRecoveryUsed = advanced.state.evidenceRecoveryUsed;
      reasoningAbortRecoveriesUsed = advanced.state.reasoningAbortRecoveriesUsed;
      awaitingMutateOnly = advanced.state.awaitingMutateOnly;
      mutateLockAllowTargetedReads = advanced.state.mutateLockAllowTargetedReads;
      consecutiveSameToolTurns = advanced.state.consecutiveSameToolTurns;
      lastUniformToolName = advanced.state.lastUniformToolName;
      lastActiveStepId = advanced.state.lastActiveStepId;
      awaitingAnswerOnly = advanced.state.awaitingAnswerOnly;
      forceFinalOnly = advanced.state.forceFinalOnly;
      diagnoseAnswerNudges = advanced.state.diagnoseAnswerNudges;
      if (advanced.kind === "done") {
        return advanced.outcome;
      }
      continue;
    }

    const answerTurn = finishModelLoopAnswerTurn({
      priorAnswer: answer,
      turnContent: turn.content,
      finishReason: turn.finishReason,
      truncated,
      messages,
      decision,
      understanding: params.understanding,
      mutationNeeded,
      changedFiles,
      gitWriteSucceeded,
      mutationCheckpointIds,
      toolCache,
      planDraftedThisRun,
      loopFileReads,
      vcsHistoryRewrite,
      truncationRecoveriesUsed,
      incompleteAnswerRecoveries,
      unfulfilledExecuteRecoveries,
      maxIncompleteAnswerRecoveries: thresholds.maxIncompleteAnswerRecoveries,
      maxUnfulfilledExecuteRecoveries:
        thresholds.maxUnfulfilledExecuteRecoveries,
      reasonCodes,
      warnings,
      offerContinue: (wallReason, partialAnswer) =>
        offerContinue(wallReason, partialAnswer),
    });
    answer = answerTurn.answer;
    incompleteAnswerRecoveries = answerTurn.incompleteAnswerRecoveries;
    unfulfilledExecuteRecoveries = answerTurn.unfulfilledExecuteRecoveries;
    if (answerTurn.kind === "continue") {
      continue;
    }
    return answerTurn.outcome;
  }
}
