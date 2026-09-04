import type { ExecutionDecision } from "../../../modules/decision-policy";
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
  /** Structured plan awaiting approval when suspensionKind is plan_approval_required. */
  plan?: PlanArtifact;
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
}

export interface AgentEngineRunCheckpointStorePort {
  save(checkpoint: AgentRunCheckpoint): Promise<void>;
  load(runId: string): Promise<AgentRunCheckpoint | undefined>;
  delete(runId: string): Promise<void>;
}
