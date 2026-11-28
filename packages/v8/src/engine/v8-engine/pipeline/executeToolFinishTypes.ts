import type { ToolGrant } from "../../../modules/decision-policy";
import type { ModelToolCall } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { ToolApprovalToken } from "../../tool-runtime";

import type {
  EstablishedFact,
  LoopFileReadTracker,
} from "../actions";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ReadLedger } from "../internal/ReadLedger";
import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";

export type ExecuteToolContinueContext = {
  toolCall: ModelToolCall;
  argumentsValue: unknown;
  summary: string | undefined;
  grant: ToolGrant;
  mutatingToolNames: ReadonlySet<string>;
  changeImpactGate?: {
    required: boolean;
    satisfied: boolean;
    lastImpactAffectedFiles?: string[];
    lastWidenVerification?: boolean;
  };
  changeImpactNudgeBudget?: { remaining: number };
  mustReadNudgeBudget?: { remaining: number };
  taskListRef?: TaskListRef;
  establishedFacts?: EstablishedFact[];
  loopFileReads?: LoopFileReadTracker;
  windowPolicy: WindowPolicy;
  toolCache: ToolCallCache;
  readLedger?: ReadLedger;
  budget: RunBudgetTracker;
  warnings: string[];
  reasonCodes: AgentReasonCode[];
  bus: EventBus;
  runId: string;
  evidence?: RunEvidence;
  taskListAutoAdvance: boolean;
  taskListAutoAdvanceBudget: { remaining: number };
  plan?: PlanArtifact;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  approvalToken: ToolApprovalToken | undefined;
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string;
  signal: AbortSignal;
};
