import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import type { EventBus } from "../internal/EventBus";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ToolLoopGuard } from "../modules/tool-loop-guard";
import type {
  MutateReadinessBudget,
  evaluateActiveStepMutateReadiness,
} from "../modules/mutate-readiness";
import type { OfferContinueFn } from "./createOfferContinue";
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

export type HandlePreSettleTurnRailsParams = {
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
  offerContinue: OfferContinueFn;
  state: Omit<PreSettleRailsState, "softNudgeAfterSettle">;
};
