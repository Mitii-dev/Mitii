import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type {
  RepoBuildState,
  VerificationRecord,
} from "../../../modules/verification";

import type { SessionControlRunResult } from "../contracts/output/AgentRunResult";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { AgentEngineRuntime } from "./runtime";
import type { StartReuseState } from "./startReuse";

export type ExecuteStartSharedState = {
  pinnedState: RepositoryStateReference | undefined;
  requestId: string;
  route: AgentRunResult["route"];
  planningDepth: AgentRunResult["planningDepth"];
  runPlan: PlanArtifact | undefined;
  runPlanStrategy: PlanStrategyDecision | undefined;
  repoBuildStateBefore: RepoBuildState | undefined;
  repoBuildStateAfter: RepoBuildState | undefined;
  verificationRecord: VerificationRecord | undefined;
  executionSeed?: import("../modules/execution-seed").ExecutionSeed;
  /** Understanding used for this run; persisted at plan-approval suspension for resume reuse. */
  understanding?: RequestUnderstandingResult;
  /** Prose offer for remaining A/B/C campaign phases after this scope. */
  nextPlanPhaseOffer?: string;
};

export type StartEarlyPipelineContinue = {
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  candidateRelativePaths: string[];
  executionSeed: import("../modules/execution-seed").ExecutionSeed;
};

export type StartEarlyPipelineOutcome =
  | { kind: "terminal"; result: AgentRunResult }
  | { kind: "continue"; state: StartEarlyPipelineContinue };

export type StartEarlyFinish = (partial: {
  status: AgentRunStatus;
  route?: AgentRunResult["route"];
  planningDepth?: AgentRunResult["planningDepth"];
  answer?: string;
  suspension?: AgentRunResult["suspension"];
  pinnedState?: RepositoryStateReference;
  sessionControl?: SessionControlRunResult;
  reasonCodes?: AgentReasonCode[];
  warnings?: string[];
  error?: { code: string; message: string };
}) => AgentRunResult;

export type StartEarlyPipelineParams = {
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  windowPolicy: WindowPolicy;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
  finish: StartEarlyFinish;
  cancelledResult: () => Promise<AgentRunResult>;
  /** Plan-approval resume: skip pin / preflight / understand / decide. */
  reuse?: StartReuseState;
};

export type StartEarlyRuntimeBundle = {
  runtime: AgentEngineRuntime;
  params: StartEarlyPipelineParams;
};
