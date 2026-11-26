import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";

import {
  buildBudgetWallRationale,
  normalizeBudgetWallReason,
  shouldOfferBudgetWallContinue,
} from "../actions";
import type { BudgetWallReason } from "../actions/buildStallContinueRationale";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { TaskListRef } from "../internal/taskListRuntime";
import {
  consultRuntimeGate,
  hubSuspendKind,
} from "../helpers/ConsultRuntimeGate";
import { saveSuspendedRun } from "../helpers/SaveSuspendedRun";
import type { ExecutionSeed } from "../modules/execution-seed";
import type { AgentEngineRuntime } from "./runtime";

export type SuspendBudgetWallContext = {
  runtime: AgentEngineRuntime;
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
  finish: (partial: {
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
  taskListRef: TaskListRef;
  repoBuildStateBefore?: RepoBuildState;
  afterState?: RepoBuildState;
  repoBuildStateAfter?: RepoBuildState;
  continueOverrideCount: number;
  maxContinueOverrides: number;
  plan?: PlanArtifact;
  executionSeed?: ExecutionSeed;
};

export async function suspendForBudgetWall(
  ctx: SuspendBudgetWallContext,
  opts: {
    wallReason: Extract<
      BudgetWallReason,
      | "incomplete_checklist"
      | "verification_repair_capped"
      | "incomplete_execute"
    >;
    messages: ModelMessage[];
    toolCache: ToolCallCache;
    changedFiles: string[];
    mutationCheckpointIds: string[];
    answer: string;
    mutationRequired?: boolean;
  },
): Promise<AgentRunResult | undefined> {
  const {
    runtime,
    runId,
    requestId,
    input,
    decision,
    bus,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    startedAtMs,
    finish,
    taskListRef,
    repoBuildStateBefore,
    afterState,
    continueOverrideCount,
    maxContinueOverrides,
    plan,
    executionSeed,
  } = ctx;

  if (
    !shouldOfferBudgetWallContinue({
      continueOverrideCount,
      maxContinueOverrides,
    })
  ) {
    return undefined;
  }
  if (!runtime.deps.checkpointStore) {
    return undefined;
  }
  const wallReason = normalizeBudgetWallReason(opts.wallReason);
  const rationale = buildBudgetWallRationale({
    reason: wallReason,
    changedFiles: opts.changedFiles,
    taskList: taskListRef.current,
    answer: opts.answer,
    mutationRequired: opts.mutationRequired,
  });
  // S10-EVAC: budget wall via gates hub.
  const wallVerdict = consultRuntimeGate("on_budget", {
    runId,
    budgetHardWall: wallReason === "budget_exhausted",
    stalledOrBlocked:
      wallReason === "stalled_or_blocked" ||
      wallReason === "incomplete_progress",
    incompleteProgress: wallReason === "incomplete_progress",
  });
  const wallKind = hubSuspendKind(wallVerdict, "continue_required");
  reasonCodes.push("stall_continue_suspended");
  warnings.push("gates_hub:budget_wall");
  await saveSuspendedRun({
    store: runtime.deps.checkpointStore,
    checkpoint: {
    runId,
    requestId,
    ...(runtime.contextEpochs.get(runId)
      ? { contextEpoch: runtime.contextEpochs.get(runId) }
      : {}),
    suspensionKind: wallKind,
    input,
    decision,
    pinnedState,
    messages: opts.messages,
    toolCacheEntries: opts.toolCache.entries(),
    changedFiles: opts.changedFiles,
    mutationCheckpointIds: opts.mutationCheckpointIds,
    stallContinueRationale: rationale,
    continuePartialAnswer: opts.answer || undefined,
    continueWallReason: wallReason,
    continueOverrideCount,
    reasonCodes,
    warnings,
    usage: budget.snapshot(),
    startedAtMs,
    excludedWaitMs: budget.getExcludedWaitMs(),
    suspendedAtMs: Date.now(),
    repoBuildStateBefore,
    repoBuildStateAfter: afterState ?? ctx.repoBuildStateAfter,
    ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
    ...(taskListRef.completedPlanStepIds &&
    taskListRef.completedPlanStepIds.length > 0
      ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
      : {}),
    ...(plan ? { plan } : {}),
    ...(executionSeed ? { executionSeed } : {}),
    },
  });
  runtime.emit(bus, {
    type: "suspended",
    runId,
    kind: "continue_required",
    rationale,
    at: runtime.isoNow(),
  });
  return finish({
    status: "suspended",
    route: decision.route,
    planningDepth: decision.planningDepth,
    answer: opts.answer || undefined,
    suspension: {
      kind: "continue_required",
      rationale,
      continuePrompt: rationale,
    },
    reasonCodes,
  });
}
