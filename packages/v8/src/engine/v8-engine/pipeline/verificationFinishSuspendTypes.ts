import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { PlanArtifact } from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";

import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ExecutionSeed } from "../modules/execution-seed";

export type VerificationSuspendFinishFn = (partial: {
  status: AgentRunStatus;
  route?: AgentRunResult["route"];
  planningDepth?: AgentRunResult["planningDepth"];
  answer?: string;
  suspension?: AgentRunResult["suspension"];
  pinnedState?: RepositoryStateReference;
  reasonCodes?: AgentReasonCode[];
  warnings?: string[];
  error?: { code: string; message: string };
}) => AgentRunResult;

export type VerificationSuspendCommon = {
  runId: string;
  requestId: string;
  input: AgentEngineStartInput;
  decision: ExecutionDecision;
  bus: EventBus;
  pinnedState: RepositoryStateReference | undefined;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  budget: RunBudgetTracker;
  startedAtMs: number;
  finish: VerificationSuspendFinishFn;
  taskListRef: TaskListRef;
  repoBuildStateBefore?: RepoBuildState;
  repoBuildStateAfter?: RepoBuildState;
  /** Refined seed to persist across Continue so resume does not drop binding. */
  executionSeed?: ExecutionSeed;
  plan?: PlanArtifact;
};
