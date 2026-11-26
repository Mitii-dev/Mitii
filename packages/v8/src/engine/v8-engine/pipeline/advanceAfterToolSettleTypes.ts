import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ToolLoopGuard } from "../modules/tool-loop-guard";
import type {
  MutateReadinessBudget,
  evaluateActiveStepMutateReadiness,
} from "../modules/mutate-readiness";
import type { OfferContinueFn } from "./createOfferContinue";
import type { SettleToolsResult } from "./settleTools";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";

export type AfterToolSettleState = {
  decision: ExecutionDecision;
  answer: string;
  gitWriteSucceeded: boolean;
  readOnlyTurnsWithoutMutation: number;
  readonlyTurnsOnActiveStep: number;
  unfulfilledExecuteRecoveries: number;
  rejectedMutationRecoveries: number;
  softMutationNudges: number;
  evidenceGateNudges: number;
  evidenceRecoveryUsed: boolean;
  reasoningAbortRecoveriesUsed: number;
  awaitingMutateOnly: boolean;
  mutateLockAllowTargetedReads: boolean;
  consecutiveSameToolTurns: number;
  lastUniformToolName: string | undefined;
  lastActiveStepId: string | undefined;
  awaitingAnswerOnly: boolean;
  forceFinalOnly: boolean;
  diagnoseAnswerNudges: number;
};

export type AdvanceAfterToolSettleResult = {
  state: AfterToolSettleState;
} & ({ kind: "continue" } | { kind: "done"; outcome: ToolLoopOutcome });

export type AdvanceAfterToolSettleParams = {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  settled: Extract<SettleToolsResult, { kind: "continue" }>;
  softNudgeAfterSettle: boolean;
  toolCalls: readonly ModelToolCall[];
  turnContent: string;
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  toolLoopGuard: ToolLoopGuard;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  taskListRef: TaskListRef;
  evidence: RunEvidence | undefined;
  budget: RunBudgetTracker;
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
    toolLoopSoftIdentical: number;
    toolLoopIdenticalCallAndResult: number;
    maxRejectedMutationRecoveries: number;
    preferredBatchSize: number;
    maxSoftMutationNudgesBeforeContinue: number;
    maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: number;
    maxDiagnoseAnswerNudges: number;
  };
  offerContinue: OfferContinueFn;
  state: AfterToolSettleState;
};
