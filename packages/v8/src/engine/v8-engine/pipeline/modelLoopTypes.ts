import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
  LlmPort,
  ModelMessage,
  ModelRequest,
} from "../../../modules/model-gateway";
import type { AgentMode } from "../../../modules/request-intake";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import type {
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import type { EstablishedFact } from "../actions";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import { ToolCallCache } from "../internal/ToolCallCache";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { SteeringCriticMode } from "../legacy/steeringFlags";

import type { V8EngineThresholdsOverrides } from "../policy";

export type V8ModelLoopParams = {
  runId: string;
  requestId: string;
  interactionMode: AgentMode;
  llm: LlmPort;
  request: ModelRequest;
  decision: ExecutionDecision;
  messages: ModelMessage[];
  bus: EventBus;
  signal: AbortSignal;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  toolCache: ToolCallCache;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string | undefined;
  taskListRef: TaskListRef;
  evidence?: RunEvidence;
  establishedFacts: EstablishedFact[];
  windowPolicy: WindowPolicy;
  /** Seeded from checkpoint when resuming after Continue. */
  continueOverrideCount?: number;
  /** Host / lab overrides for v8 knobs (merged onto band defaults). */
  thresholdOverrides?: V8EngineThresholdsOverrides | Record<string, number>;
  /**
   * Re-arm mutate lock on Continue after unfulfilled/readonly thrash so
   * discovery stays stripped until apply_patch lands.
   */
  armMutateLockOnStart?: boolean;
  /** Pre-mutation critic mode from steering (default off). */
  criticMode?: SteeringCriticMode;
  understanding?: RequestUnderstandingResult;
  /** Trusted/weak seed from early pipeline — gates patch-required arming. */
  executionSeed?: import("../modules/execution-seed").ExecutionSeed;
  repoBuildStateBefore?: RepoBuildState;
  memoryFacts?: readonly { id: string; content: string }[];
  memoryQuery?: string;
  memoryWorkspaceId?: string;
  memoryFileTargets?: readonly string[];
  logVerbosity?: AgentLogVerbosity;
  selectedSkillIds?: readonly string[];
  projectRuleIds?: readonly string[];
  environmentIds?: readonly string[];
  instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
};
