import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";

/**
 * Mutable counters and authority carried across model/tool loop turns.
 * Handlers mutate this object in place and return a {@link ModelLoopStepResult}.
 */
export type ModelLoopSession = {
  decision: ExecutionDecision;
  selectedSkillIds: string[];
  answer: string;
  truncationRecoveries: number;
  incompleteAnswerRecoveries: number;
  unfulfilledExecuteRecoveries: number;
  pendingTextContinuation: string;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  successfulVerificationAfterMutation: boolean;
  explorationStallNudges: number;
  rejectedMutationRecoveries: number;
  rejectedToolRecoveries: number;
  readOnlyToolTurnsWithoutMutation: number;
  readOnlyToolTurnsAfterMutation: number;
  afterMutationReadOnlyNudges: number;
  awaitingReadOnlyMutationRetry: boolean;
  readOnlyMutationRetryAttempts: number;
  mutationBlockerAsked: boolean;
  awaitingRejectedMutationRetry:
    | {
        allowTargetedDiscovery: boolean;
        targetedDiscoveryToolCallsUsed: number;
        maxTargetedDiscoveryToolCalls: number;
      }
    | undefined;
  lastPromptCacheClass: PromptCacheClass | undefined;
};

export type { ModelLoopStepResult } from "./modelLoopStep";
