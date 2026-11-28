/**
 * Critic → settleToolBatch → advanceAfterToolSettle for one model turn with tools.
 */
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { AgentMode } from "../../../modules/request-intake";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepositoryStateReference } from "../../../modules/repository-state";

import type { EstablishedFact } from "../actions";
import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { OfferContinueFn } from "./createOfferContinue";
import { applyMutationCriticTurn } from "./applyMutationCriticTurn";
import { advanceAfterToolSettle } from "./advanceAfterToolSettle";
import { settleToolBatch } from "./settleTools";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type { ModelLoopSession } from "./modelLoopInit";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";

export async function settleModelLoopToolTurn(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  requestId: string;
  interactionMode: AgentMode;
  bus: EventBus;
  signal: AbortSignal;
  session: ModelLoopSession;
  softNudgeAfterSettle: boolean;
  toolCalls: readonly ModelToolCall[];
  turnContent: string;
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string | undefined;
  taskListRef: TaskListRef;
  evidence: RunEvidence | undefined;
  establishedFacts: EstablishedFact[];
  windowPolicy: WindowPolicy;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  understanding: RequestUnderstandingResult | undefined;
  offerContinue: OfferContinueFn;
}): Promise<
  | { kind: "return"; outcome: ToolLoopOutcome }
  | { kind: "continue" }
> {
  const {
    runtime,
    runId,
    requestId,
    interactionMode,
    bus,
    signal,
    session,
    softNudgeAfterSettle,
    toolCalls,
    turnContent,
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
    understanding,
    offerContinue,
  } = params;

  session.truncationRecoveriesUsed = 0;

  const criticTurn = applyMutationCriticTurn({
    runtime,
    bus,
    runId,
    decision: session.decision,
    toolCalls,
    turnContent,
    messages,
    reasonCodes,
    warnings,
    criticMode: session.criticMode,
    understanding,
  });
  session.decision = criticTurn.decision;
  if (criticTurn.kind === "continue") {
    return { kind: "continue" };
  }

  const settled = await settleToolBatch({
    runtime,
    runId,
    requestId,
    interactionMode,
    bus,
    signal,
    decision: session.decision,
    toolCalls,
    turnContent,
    messages,
    toolCache,
    readLedger: session.readLedger,
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
    answer: session.answer,
    toolLoopGuard: session.toolLoopGuard,
    mustReadNudgeBudget: session.mustReadNudgeBudget,
    changeImpactGate: session.changeImpactGate,
    changeImpactNudgeBudget: session.changeImpactNudgeBudget,
    loopFileReads: session.loopFileReads,
    awaitingMutateOnly: session.awaitingMutateOnly,
    mutateLockAllowTargetedReads: session.mutateLockAllowTargetedReads,
  });
  if (settled.kind === "return") {
    return { kind: "return", outcome: settled.outcome };
  }
  session.decision = settled.decision;

  const advanced = advanceAfterToolSettle({
    runtime,
    bus,
    runId,
    settled,
    softNudgeAfterSettle,
    toolCalls,
    turnContent,
    messages,
    toolCache,
    toolLoopGuard: session.toolLoopGuard,
    changedFiles,
    mutationCheckpointIds,
    taskListRef,
    evidence,
    budget,
    reasonCodes,
    warnings,
    mutationNeeded: session.mutationNeeded,
    vcsHistoryRewrite: session.vcsHistoryRewrite,
    planDraftedThisRun: session.planDraftedThisRun,
    seedTrusted: session.seedTrusted,
    stepReadonlyTurnsBeforeGate: session.stepReadonlyTurnsBeforeGate,
    readonlyTurnsBeforeMutationNudge: session.readonlyTurnsBeforeMutationNudge,
    mutateReadinessBudget: session.mutateReadinessBudget,
    changeImpactGate: session.changeImpactGate,
    evaluateStepReadiness: session.evaluateStepReadiness,
    loopFileReads: session.loopFileReads,
    thresholds: {
      toolLoopSoftIdentical: session.thresholds.toolLoopSoftIdentical,
      toolLoopIdenticalCallAndResult:
        session.thresholds.toolLoopIdenticalCallAndResult,
      maxRejectedMutationRecoveries:
        session.thresholds.maxRejectedMutationRecoveries,
      preferredBatchSize: session.thresholds.preferredBatchSize,
      maxSoftMutationNudgesBeforeContinue:
        session.thresholds.maxSoftMutationNudgesBeforeContinue,
      maxRepeatedReadonlyToolTurnsBeforeAnswerNudge:
        session.thresholds.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge,
      maxDiagnoseAnswerNudges: session.thresholds.maxDiagnoseAnswerNudges,
    },
    offerContinue,
    state: {
      decision: session.decision,
      answer: session.answer,
      gitWriteSucceeded: session.gitWriteSucceeded,
      readOnlyTurnsWithoutMutation: session.readOnlyTurnsWithoutMutation,
      readonlyTurnsOnActiveStep: session.readonlyTurnsOnActiveStep,
      unfulfilledExecuteRecoveries: session.unfulfilledExecuteRecoveries,
      rejectedMutationRecoveries: session.rejectedMutationRecoveries,
      softMutationNudges: session.softMutationNudges,
      evidenceGateNudges: session.evidenceGateNudges,
      evidenceRecoveryUsed: session.evidenceRecoveryUsed,
      reasoningAbortRecoveriesUsed: session.reasoningAbortRecoveriesUsed,
      awaitingMutateOnly: session.awaitingMutateOnly,
      mutateLockAllowTargetedReads: session.mutateLockAllowTargetedReads,
      consecutiveSameToolTurns: session.consecutiveSameToolTurns,
      lastUniformToolName: session.lastUniformToolName,
      lastActiveStepId: session.lastActiveStepId,
      awaitingAnswerOnly: session.awaitingAnswerOnly,
      forceFinalOnly: session.forceFinalOnly,
      diagnoseAnswerNudges: session.diagnoseAnswerNudges,
    },
  });
  session.decision = advanced.state.decision;
  session.answer = advanced.state.answer;
  session.gitWriteSucceeded = advanced.state.gitWriteSucceeded;
  session.readOnlyTurnsWithoutMutation =
    advanced.state.readOnlyTurnsWithoutMutation;
  session.readonlyTurnsOnActiveStep = advanced.state.readonlyTurnsOnActiveStep;
  session.unfulfilledExecuteRecoveries =
    advanced.state.unfulfilledExecuteRecoveries;
  session.rejectedMutationRecoveries = advanced.state.rejectedMutationRecoveries;
  session.softMutationNudges = advanced.state.softMutationNudges;
  session.evidenceGateNudges = advanced.state.evidenceGateNudges;
  session.evidenceRecoveryUsed = advanced.state.evidenceRecoveryUsed;
  session.reasoningAbortRecoveriesUsed =
    advanced.state.reasoningAbortRecoveriesUsed;
  session.awaitingMutateOnly = advanced.state.awaitingMutateOnly;
  session.mutateLockAllowTargetedReads =
    advanced.state.mutateLockAllowTargetedReads;
  session.consecutiveSameToolTurns = advanced.state.consecutiveSameToolTurns;
  session.lastUniformToolName = advanced.state.lastUniformToolName;
  session.lastActiveStepId = advanced.state.lastActiveStepId;
  session.awaitingAnswerOnly = advanced.state.awaitingAnswerOnly;
  session.forceFinalOnly = advanced.state.forceFinalOnly;
  session.diagnoseAnswerNudges = advanced.state.diagnoseAnswerNudges;
  if (advanced.kind === "done") {
    return { kind: "return", outcome: advanced.outcome };
  }
  return { kind: "continue" };
}
