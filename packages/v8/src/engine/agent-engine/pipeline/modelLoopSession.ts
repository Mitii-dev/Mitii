import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import type { ContextEpoch } from "../internal/context-epoch";
import type { InMemorySessionHistoryArchive } from "../internal/session-history";

/**
 * Mutable counters and authority carried across model/tool loop turns.
 * Handlers mutate this object in place and return a {@link ModelLoopStepResult}.
 */
export type ModelLoopSession = {
  decision: ExecutionDecision;
  selectedSkillIds: string[];
  /** Project rule instruction ids for Context Epoch sources. */
  projectRuleIds: string[];
  /** Environment instruction ids for Context Epoch sources. */
  environmentIds: string[];
  answer: string;
  truncationRecoveries: number;
  incompleteAnswerRecoveries: number;
  unfulfilledExecuteRecoveries: number;
  /** Successful emit_review_finding calls this run. */
  emitReviewFindingCount: number;
  /** Nudges when structured review ended without findings. */
  structuredReviewRecoveries: number;
  pendingTextContinuation: string;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  successfulVerificationAfterMutation: boolean;
  explorationStallNudges: number;
  /** How many times the user already approved Continue on a stall wall. */
  continueOverrideCount: number;
  rejectedMutationRecoveries: number;
  rejectedToolRecoveries: number;
  readOnlyToolTurnsWithoutMutation: number;
  readOnlyToolTurnsAfterMutation: number;
  afterMutationReadOnlyNudges: number;
  awaitingReadOnlyMutationRetry: boolean;
  readOnlyMutationRetryAttempts: number;
  /** Count of allowed evidence-read batches after the mutation nudge. */
  postNudgeEvidenceReadTurns: number;
  /**
   * Diagnose/ask: consecutive turns that only invoked the same tool name
   * (e.g. read_diagnostics thrash).
   */
  consecutiveSameToolTurns: number;
  lastUniformToolName: string | undefined;
  diagnoseAnswerNudges: number;
  /** Strip tools so the next model turn must answer. */
  awaitingAnswerOnly: boolean;
  mutationBlockerAsked: boolean;
  awaitingRejectedMutationRetry:
    | {
        allowTargetedDiscovery: boolean;
        targetedDiscoveryToolCallsUsed: number;
        maxTargetedDiscoveryToolCalls: number;
      }
    | undefined;
  lastPromptCacheClass: PromptCacheClass | undefined;
  /**
   * Active Context Epoch for this run (OpenCode formula: immutable baseline
   * until compaction / replace). Undefined until first system baseline is seen.
   */
  contextEpoch: ContextEpoch | undefined;
  /**
   * Durable Session History archive (OpenCode dual-store). Dropped turns leave
   * model projection but remain searchable via hybrid session-history retrieve.
   */
  sessionHistoryArchive: InMemorySessionHistoryArchive;
};

export type { ModelLoopStepResult } from "./modelLoopStep";
