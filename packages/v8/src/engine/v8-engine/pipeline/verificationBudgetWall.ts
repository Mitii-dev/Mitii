import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";

import {
  buildBudgetWallRationale,
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
  const rationale = buildBudgetWallRationale({
    reason: opts.wallReason,
    changedFiles: opts.changedFiles,
    taskList: taskListRef.current,
    answer: opts.answer,
    mutationRequired: opts.mutationRequired,
  });
  reasonCodes.push("stall_continue_suspended");
  await runtime.deps.checkpointStore.save({
    runId,
    requestId,
    ...(runtime.contextEpochs.get(runId)
      ? { contextEpoch: runtime.contextEpochs.get(runId) }
      : {}),
    suspensionKind: "continue_required",
    input,
    decision,
    pinnedState,
    messages: opts.messages,
    toolCacheEntries: opts.toolCache.entries(),
    changedFiles: opts.changedFiles,
    mutationCheckpointIds: opts.mutationCheckpointIds,
    stallContinueRationale: rationale,
    continuePartialAnswer: opts.answer || undefined,
    continueWallReason: opts.wallReason,
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
