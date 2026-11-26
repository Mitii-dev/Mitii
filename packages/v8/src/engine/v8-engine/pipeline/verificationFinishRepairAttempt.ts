/**
 * Attempt one verification repair model/tool loop when the failed gate is repairable.
 */
import type { ModelRequest } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import {
  nextStalledRepairCount,
  resolveLoopPolicyThresholds,
  shouldContinueVerificationRepair,
} from "../actions";
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
import type { VerificationRepairState } from "./verificationFinishFailedTypes";
import type { FinishAfterLoopFinish } from "./verificationFinishTypes";
import { runVerificationRepairLoop } from "./verificationFinishRepairRun";

type FailedGate = Extract<VerificationGateOutcome, { kind: "failed" }>;

export async function tryVerificationRepairAttempt(params: {
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
    memoryFacts?: readonly { id: string; content: string }[];
    memoryQuery?: string;
    memoryWorkspaceId?: string;
    memoryFileTargets?: readonly string[];
    establishedFacts?: import("../actions").EstablishedFact[];
    selectedSkillIds?: string[];
    projectRuleIds?: string[];
    environmentIds?: string[];
    instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
    plan?: import("../../../modules/planning").PlanArtifact;
    executionSeed?: import("../modules/execution-seed").ExecutionSeed;
  };
  verificationOutcome: FailedGate;
  loopChangedFiles: string[];
  loopMutationIds: string[];
  thresholds: ReturnType<typeof resolveLoopPolicyThresholds>["thresholds"];
  continueOverrideCount: number;
  dirtyPaths: readonly string[] | undefined;
  state: VerificationRepairState;
}): Promise<
  | { kind: "continue"; state: VerificationRepairState }
  | { kind: "return"; result: AgentRunResult }
  | { kind: "exhausted"; state: VerificationRepairState }
> {
  const {
    runtime,
    runId,
    pinnedState,
    reasonCodes,
    budget,
    finish,
    cancelledResult,
    verificationOutcome,
    thresholds,
    windowPolicy,
    input,
  } = params;

  let {
    currentOutcome,
    decision,
    afterState,
    repairAttempts,
    previousAfterErrorCount,
    consecutiveStalledRepairs,
  } = params.state;

  const currentAfterErrorCount =
    verificationOutcome.comparison?.afterErrorCount ??
    verificationOutcome.verification?.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ).length ??
    0;
  consecutiveStalledRepairs = nextStalledRepairCount({
    previousAfterErrorCount,
    currentAfterErrorCount,
    consecutiveStalledRepairs,
  });
  previousAfterErrorCount = currentAfterErrorCount;

  const repairDecision = shouldContinueVerificationRepair({
    repairAttempts,
    explorationDepth: input.explorationDepth,
    consecutiveStalledRepairs,
    // Near the host wall-time budget a repair turn cannot finish + re-verify;
    // report the failed gate with partial results instead.
    canStartModelCall:
      budget.canStartModelCall() && !budget.isNearWallDeadline(),
    maxAttempts: windowPolicy.run.maxVerificationRepairs,
    thresholds,
  });
  const canRepair =
    verificationOutcome.repairable &&
    repairDecision.continue &&
    currentOutcome.kind === "completed";

  if (!(canRepair && currentOutcome.kind === "completed")) {
    return {
      kind: "exhausted",
      state: {
        currentOutcome,
        decision,
        afterState,
        repairAttempts,
        previousAfterErrorCount,
        consecutiveStalledRepairs,
      },
    };
  }

  const nextState = await runVerificationRepairLoop({
    ...params,
    state: {
      currentOutcome,
      decision,
      afterState,
      repairAttempts,
      previousAfterErrorCount,
      consecutiveStalledRepairs,
    },
  });
  currentOutcome = nextState.currentOutcome;
  decision = nextState.decision;
  afterState = nextState.afterState;
  repairAttempts = nextState.repairAttempts;
  previousAfterErrorCount = nextState.previousAfterErrorCount;
  consecutiveStalledRepairs = nextState.consecutiveStalledRepairs;

  if (
    currentOutcome.kind === "completed" ||
    currentOutcome.kind === "approval_required" ||
    currentOutcome.kind === "continue_required" ||
    currentOutcome.kind === "grant_expansion_required"
  ) {
    return {
      kind: "continue",
      state: {
        currentOutcome,
        decision,
        afterState,
        repairAttempts,
        previousAfterErrorCount,
        consecutiveStalledRepairs,
      },
    };
  }
  if (currentOutcome.kind === "cancelled") {
    await runtime.safeUnpin(runId, pinnedState);
    return { kind: "return", result: await cancelledResult() };
  }
  if (currentOutcome.kind === "failed") {
    await runtime.safeUnpin(runId, pinnedState);
    return {
      kind: "return",
      result: finish({
        status: "failed",
        answer: currentOutcome.answer,
        reasonCodes: [...reasonCodes, ...currentOutcome.extraReasons],
        error: currentOutcome.error,
      }),
    };
  }
  reasonCodes.push("budget_exhausted");
  return {
    kind: "exhausted",
    state: {
      currentOutcome,
      decision,
      afterState,
      repairAttempts,
      previousAfterErrorCount,
      consecutiveStalledRepairs,
    },
  };
}
