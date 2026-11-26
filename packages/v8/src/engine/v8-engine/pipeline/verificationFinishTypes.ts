import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelRequest } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type {
  RepoBuildState,
  VerificationRecord,
} from "../../../modules/verification";

import type { EstablishedFact } from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ToolLoopOutcome } from "./types";

export type FinishAfterLoopFinish = (partial: {
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

export type FinishAfterLoopContext = {
  understanding?: RequestUnderstandingResult;
  skillsQuery?: string;
  mode?: "ask" | "plan" | "agent";
  projects?: readonly ProjectDescriptor[];
  memoryFacts?: readonly { id: string; content: string }[];
  memoryQuery?: string;
  memoryWorkspaceId?: string;
  memoryFileTargets?: readonly string[];
  selectedSkillIds?: string[];
  projectRuleIds?: string[];
  environmentIds?: string[];
  instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
  requiredSkillIds?: string[];
  excludedSkillIds?: string[];
  establishedFacts: EstablishedFact[];
  plan?: PlanArtifact;
  executionSeed?: import("../modules/execution-seed").ExecutionSeed;
  nextPlanPhaseOffer?: string;
};

export type FinishAfterLoopParams = {
  runId: string;
  requestId: string;
  input: AgentEngineStartInput;
  request: ModelRequest;
  decision: ExecutionDecision;
  bus: EventBus;
  signal: AbortSignal;
  pinnedState: RepositoryStateReference | undefined;
  dirtyPaths: readonly string[] | undefined;
  loopOutcome: ToolLoopOutcome;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  budget: RunBudgetTracker;
  startedAtMs: number;
  finish: FinishAfterLoopFinish;
  cancelledResult: () => Promise<AgentRunResult>;
  taskListRef: TaskListRef;
  repoBuildStateBefore?: RepoBuildState;
  repoBuildStateAfter?: RepoBuildState;
  evidence?: RunEvidence;
  onRepoBuildStateAfter?: (state: RepoBuildState) => void;
  onVerificationRecord?: (record: VerificationRecord) => void;
  windowPolicy: WindowPolicy;
  /** Seeded after a Continue resume so nested walls honor the override cap. */
  continueOverrideCount?: number;
  loopContext?: FinishAfterLoopContext;
};

export type FinishLoopMutable = {
  currentOutcome: ToolLoopOutcome;
  decision: ExecutionDecision;
  afterState?: RepoBuildState;
  repairAttempts: number;
  previousAfterErrorCount?: number;
  consecutiveStalledRepairs: number;
};
