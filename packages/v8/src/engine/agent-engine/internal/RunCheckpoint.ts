import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ContextEpoch } from "./context-epoch";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type { TaskList } from "../../../modules/task-list";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";
import type { ToolResult } from "../../tool-runtime";

import type { AgentEngineStartInput } from "../contracts/input/AgentEngineInput";
import type {
  AgentReasonCode,
  AgentRunUsage,
} from "../contracts/output/AgentRunResult";
import type {
  RestorePoint,
  RestorePointSummary,
} from "../contracts/output/RestorePoint";
import type { BudgetWallReason } from "../actions/buildStallContinueRationale";
import type { ClarificationSession } from "../actions/buildClarificationPayload";

export interface PendingApprovalState {
  approvalId: string;
  fingerprint: string;
  toolName: string;
  callId: string;
  arguments: unknown;
  paths: string[];
}

export interface PendingGrantExpansionState {
  expansionId: string;
  extraPaths: string[];
}

/**
 * Persisted run checkpoint for suspension/resume.
 * Completed tool callIds are retained so resume does not replay them.
 */
export interface AgentRunCheckpoint {
  runId: string;
  requestId: string;
  suspensionKind:
    | "approval_required"
    | "clarification_required"
    | "plan_approval_required"
    | "grant_expansion_required"
    | "continue_required";
  input: AgentEngineStartInput;
  decision: ExecutionDecision;
  pinnedState?: RepositoryStateReference;
  messages: ModelMessage[];
  toolCacheEntries: Array<[string, ToolResult]>;
  pendingApproval?: PendingApprovalState;
  /** Paths awaiting approval before grant widen. */
  pendingGrantExpansion?: PendingGrantExpansionState;
  /** User-facing stall summary when suspensionKind is continue_required. */
  stallContinueRationale?: string;
  /** Best user-facing answer available if the user chooses Stop. */
  continuePartialAnswer?: string;
  /** Why continue_required was raised. */
  continueWallReason?: BudgetWallReason;
  /** How many Continue approvals the user has already granted this run. */
  continueOverrideCount?: number;
  /** Structured plan awaiting approval when suspensionKind is plan_approval_required. */
  plan?: PlanArtifact;
  /** Clarification option map for structured resume (ballot v2). */
  clarificationSession?: ClarificationSession;
  /** Strategy that produced `plan`; restored on resume so the prompt contract survives. */
  planStrategy?: PlanStrategyDecision;
  /** Live task list at suspension time. */
  taskList?: TaskList;
  /** Durable finished plan step ids (survives desk refill). */
  completedPlanStepIds?: string[];
  repoBuildStateBefore?: RepoBuildState;
  repoBuildStateAfter?: RepoBuildState;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  usage: AgentRunUsage;
  startedAtMs: number;
  /**
   * Accumulated user-wait time already excluded from wall_time budget
   * (prior approval suspensions in this run).
   */
  excludedWaitMs?: number;
  /** Wall clock when this suspension began; resume credits the delta. */
  suspendedAtMs?: number;
  /**
   * OpenCode epoch formula persisted with the run so resume does not
   * rebuild the baseline. `{ epochId, baseline, snapshot, createdAt }`.
   */
  contextEpoch?: ContextEpoch;
}

export interface AgentEngineRunCheckpointStorePort {
  save(checkpoint: AgentRunCheckpoint): Promise<void>;
  load(runId: string): Promise<AgentRunCheckpoint | undefined>;
  delete(runId: string): Promise<void>;
  /** Persist a durable undo point after a successful mutation. */
  saveRestorePoint(point: RestorePoint): Promise<void>;
  loadRestorePoint(
    runId: string,
    restorePointId: string,
  ): Promise<RestorePoint | undefined>;
  listRestorePoints(runId: string): Promise<RestorePointSummary[]>;
  /** Remove all restore points for a run (e.g. after terminal commit). */
  deleteRestorePoints(runId: string): Promise<void>;
}
