import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";

import { createOfferContinue } from "./createOfferContinue";
import { handleWallTimeDeadline } from "./handleWallTimeDeadline";
import { runModelLoopModelTurn } from "./runModelLoopModelTurn";
import { finishModelLoopAnswerTurn } from "./finishModelLoopAnswerTurn";
import { handlePreSettleTurnRails } from "./handlePreSettleTurnRails";
import { initModelLoopSession } from "./modelLoopInit";
import { settleModelLoopToolTurn } from "./modelLoopSettleTools";
import type { V8ModelLoopParams } from "./modelLoopTypes";
import {
  applyPreSettleStateToSession,
  snapshotPreSettleState,
} from "./modelLoopApplyPreSettle";

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

  const session = initModelLoopSession({
    runtime,
    loop: params,
    reasonCodes,
    warnings,
  });

  const offerContinue = createOfferContinue({
    messages,
    toolCache,
    changedFiles,
    mutationCheckpointIds,
    getDecision: () => session.decision,
    continueOverrideCount: session.continueOverrideCount,
    maxContinueOverrides: session.thresholds.maxContinueOverrides,
    getTaskList: () => taskListRef.current,
    mutationRequired: session.mutationNeeded,
    reasonCodes,
  });

  while (true) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }
    const wall = handleWallTimeDeadline({
      budget,
      mutationApplied:
        changedFiles.length > 0 || session.gitWriteSucceeded,
      mutationRequired: session.mutationNeeded,
      wallTimeNudged: session.wallTimeNudged,
      answer: session.answer,
      changedFiles,
      mutationCheckpointIds,
      messages,
      toolCache,
      decision: session.decision,
      reasonCodes,
      warnings,
      offerContinue,
    });
    session.wallTimeNudged = wall.wallTimeNudged;
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
      decision: session.decision,
      forceFinalOnly: session.forceFinalOnly,
      awaitingAnswerOnly: session.awaitingAnswerOnly,
      awaitingMutateOnly: session.awaitingMutateOnly,
      mutateLockAllowTargetedReads: session.mutateLockAllowTargetedReads,
      toolLoopGuard: session.toolLoopGuard,
      answer: session.answer,
      reasonCodes,
      warnings,
      logVerbosity: session.logVerbosity,
      lastPromptCacheClass: session.lastPromptCacheClass,
      emittedLoopPressureWarning: session.emittedLoopPressureWarning,
      emittedLoopCompactionWarning: session.emittedLoopCompactionWarning,
      contextEpoch: session.contextEpoch,
      memoryFacts: session.memoryFacts,
      memoryQuery: params.memoryQuery,
      memoryWorkspaceId: params.memoryWorkspaceId,
      memoryFileTargets: params.memoryFileTargets,
      establishedFacts,
      repoBuildStateBefore: params.repoBuildStateBefore,
      selectedSkillIds: params.selectedSkillIds,
      projectRuleIds: params.projectRuleIds,
      environmentIds: params.environmentIds,
      instructionBodies: params.instructionBodies,
      sessionHistoryArchive: session.sessionHistoryArchive,
      maxReasoningCharsWithoutProgress:
        session.thresholds.maxReasoningCharsWithoutProgress,
      offerContinue,
    });
    if (modelTurn.kind === "cancelled") {
      return { kind: "cancelled" };
    }
    if (modelTurn.kind === "done") {
      return modelTurn.outcome;
    }
    session.memoryFacts = modelTurn.memoryFacts;
    session.emittedLoopPressureWarning = modelTurn.emittedLoopPressureWarning;
    session.emittedLoopCompactionWarning =
      modelTurn.emittedLoopCompactionWarning;
    session.lastPromptCacheClass = modelTurn.lastPromptCacheClass;
    session.contextEpoch = modelTurn.contextEpoch;
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
      toolLoopGuard: session.toolLoopGuard,
      answer: session.answer,
      reasonCodes,
      warnings,
      mutationNeeded: session.mutationNeeded,
      changedFiles,
      gitWriteSucceeded: session.gitWriteSucceeded,
      taskListRef,
      evidence,
      seedTrusted: session.seedTrusted,
      stepReadonlyTurnsBeforeGate: session.stepReadonlyTurnsBeforeGate,
      readonlyTurnsBeforeMutationNudge: session.readonlyTurnsBeforeMutationNudge,
      mutateReadinessBudget: session.mutateReadinessBudget,
      evaluateStepReadiness: session.evaluateStepReadiness,
      planDraftedThisRun: session.planDraftedThisRun,
      vcsHistoryRewrite: session.vcsHistoryRewrite,
      loopFileReads: session.loopFileReads,
      thresholds: {
        maxTruncationRecoveries: session.thresholds.maxTruncationRecoveries,
        maxReasoningAbortRecoveries:
          session.thresholds.maxReasoningAbortRecoveries,
        maxSoftMutationNudgesBeforeContinue:
          session.thresholds.maxSoftMutationNudgesBeforeContinue,
      },
      offerContinue,
      state: snapshotPreSettleState(session),
    });
    softNudgeAfterSettle = applyPreSettleStateToSession({
      session,
      state: preSettle.state,
    });
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
      const settled = await settleModelLoopToolTurn({
        runtime,
        runId,
        requestId,
        interactionMode,
        bus,
        signal,
        session,
        softNudgeAfterSettle,
        toolCalls,
        turnContent: turn.content,
        messages,
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
        budget,
        reasonCodes,
        warnings,
        understanding: params.understanding,
        offerContinue,
      });
      if (settled.kind === "return") {
        return settled.outcome;
      }
      continue;
    }

    const answerTurn = finishModelLoopAnswerTurn({
      priorAnswer: session.answer,
      turnContent: turn.content,
      finishReason: turn.finishReason,
      truncated,
      messages,
      decision: session.decision,
      understanding: params.understanding,
      mutationNeeded: session.mutationNeeded,
      changedFiles,
      gitWriteSucceeded: session.gitWriteSucceeded,
      mutationCheckpointIds,
      toolCache,
      planDraftedThisRun: session.planDraftedThisRun,
      loopFileReads: session.loopFileReads,
      vcsHistoryRewrite: session.vcsHistoryRewrite,
      truncationRecoveriesUsed: session.truncationRecoveriesUsed,
      incompleteAnswerRecoveries: session.incompleteAnswerRecoveries,
      unfulfilledExecuteRecoveries: session.unfulfilledExecuteRecoveries,
      maxIncompleteAnswerRecoveries:
        session.thresholds.maxIncompleteAnswerRecoveries,
      maxUnfulfilledExecuteRecoveries:
        session.thresholds.maxUnfulfilledExecuteRecoveries,
      reasonCodes,
      warnings,
      offerContinue: (wallReason, partialAnswer) =>
        offerContinue(wallReason, partialAnswer),
    });
    session.answer = answerTurn.answer;
    session.incompleteAnswerRecoveries = answerTurn.incompleteAnswerRecoveries;
    session.unfulfilledExecuteRecoveries =
      answerTurn.unfulfilledExecuteRecoveries;
    if (answerTurn.kind === "continue") {
      continue;
    }
    return answerTurn.outcome;
  }
}
