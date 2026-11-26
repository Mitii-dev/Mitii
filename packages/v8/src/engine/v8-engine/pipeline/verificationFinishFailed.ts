import type { ModelRequest } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RepoBuildState,
  VerificationRecord,
  VerificationRecordStatus,
} from "../../../modules/verification";

import { resolveLoopPolicyThresholds } from "../actions";
import type { TaskListRef } from "../internal/taskListRuntime";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import type { VerificationGateOutcome } from "./types";
import type { SuspendBudgetWallContext } from "./verificationBudgetWall";
import { tryVerificationRepairAttempt } from "./verificationFinishRepairAttempt";
import { finishFailedVerificationTerminal } from "./verificationFinishFailedTerminal";
import type { VerificationRepairState } from "./verificationFinishFailedTypes";
import type { FinishAfterLoopFinish } from "./verificationFinishTypes";

export type { VerificationRepairState } from "./verificationFinishFailedTypes";

type FailedGate = Extract<VerificationGateOutcome, { kind: "failed" }>;

export async function handleVerificationFailed(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  requestId: string;
  input: AgentEngineStartInput;
  request: ModelRequest;
  bus: EventBus;
  signal: AbortSignal;
  pinnedState: RepositoryStateReference | undefined;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  budget: RunBudgetTracker;
  startedAtMs: number;
  finish: FinishAfterLoopFinish;
  cancelledResult: () => Promise<AgentRunResult>;
  taskListRef: TaskListRef;
  repoBuildStateBefore?: RepoBuildState;
  evidence?: RunEvidence;
  windowPolicy: WindowPolicy;
  loopContext?: {
    understanding?: import("../../../modules/request-understanding").RequestUnderstandingResult;
    skillsQuery?: string;
    mode?: "ask" | "plan" | "agent";
    projects?: readonly import("../../../modules/repository-state").ProjectDescriptor[];
    memoryFacts?: readonly { id: string; content: string }[];
    memoryQuery?: string;
    memoryWorkspaceId?: string;
    memoryFileTargets?: readonly string[];
    establishedFacts?: import("../actions").EstablishedFact[];
    selectedSkillIds?: string[];
    projectRuleIds?: string[];
    environmentIds?: string[];
    instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
    requiredSkillIds?: string[];
    excludedSkillIds?: string[];
    plan?: import("../../../modules/planning").PlanArtifact;
    executionSeed?: import("../modules/execution-seed").ExecutionSeed;
  };
  verificationOutcome: FailedGate;
  record: VerificationRecord | undefined;
  recordStatus: VerificationRecordStatus;
  loopChangedFiles: string[];
  loopMutationIds: string[];
  loopAnswer: string | undefined;
  thresholds: ReturnType<typeof resolveLoopPolicyThresholds>["thresholds"];
  continueOverrideCount: number;
  dirtyPaths: readonly string[] | undefined;
  onVerificationRecord?: (record: VerificationRecord) => void;
  state: VerificationRepairState;
}): Promise<
  | { kind: "return"; result: AgentRunResult }
  | { kind: "continue"; state: VerificationRepairState }
> {
  const {
    runtime,
    runId,
    requestId,
    input,
    request,
    bus,
    signal,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    finish,
    cancelledResult,
    taskListRef,
    repoBuildStateBefore,
    evidence,
    windowPolicy,
    loopContext,
    verificationOutcome,
    record,
    recordStatus,
    loopChangedFiles,
    loopMutationIds,
    loopAnswer,
    thresholds,
    continueOverrideCount,
    dirtyPaths,
  } = params;

  let state = params.state;

  const budgetWallCtx = (): SuspendBudgetWallContext => ({
    runtime,
    runId,
    requestId,
    input,
    decision: state.decision,
    bus,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    startedAtMs: params.startedAtMs,
    finish,
    taskListRef,
    repoBuildStateBefore,
    afterState: state.afterState,
    repoBuildStateAfter: state.afterState,
    continueOverrideCount,
    maxContinueOverrides: thresholds.maxContinueOverrides,
    plan: loopContext?.plan,
  });

  const repair = await tryVerificationRepairAttempt({
    runtime,
    runId,
    requestId,
    input,
    request,
    bus,
    signal,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    finish,
    cancelledResult,
    taskListRef,
    repoBuildStateBefore,
    evidence,
    windowPolicy,
    loopContext,
    verificationOutcome,
    loopChangedFiles,
    loopMutationIds,
    thresholds,
    continueOverrideCount,
    dirtyPaths,
    state,
  });
  if (repair.kind === "continue" || repair.kind === "return") {
    return repair;
  }
  state = repair.state;

  return finishFailedVerificationTerminal({
    runtime,
    runId,
    requestId,
    input,
    bus,
    signal,
    pinnedState,
    reasonCodes,
    warnings,
    finish,
    verificationOutcome,
    record,
    recordStatus,
    loopChangedFiles,
    loopMutationIds,
    loopAnswer,
    repoBuildStateBefore,
    onVerificationRecord: params.onVerificationRecord,
    budgetWallCtx,
    state,
  });
}
