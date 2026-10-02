/**
 * After a Medium/Large Agent plan: require a concrete plan-derived checklist.
 * One seed-informed Change targetRefs recovery is allowed; never invent a row
 * from seed alone. Hollow plans suspend for clarification.
 */
import type { ExecutionDecision } from "../../../../modules/decision-policy";
import type { PlanArtifact, PlanStrategyDecision } from "../../../../modules/planning";
import type { AgentEngineStartInput, AgentReasonCode, AgentRunResult } from "../../contracts";
import type { EventBus } from "../../internal/EventBus";
import type { RunBudgetTracker } from "../../internal/RunBudget";
import type { TaskListRef } from "../../internal/taskListRuntime";
import {
  applyExecutionSeedToTaskList,
} from "./applyExecutionSeedToTaskList";
import {
  ensureConcreteTaskListFromPlan,
} from "./ensureConcreteTaskList";
import type { ExecutionSeed } from "./resolve";
import type { AgentEngineRuntime } from "../../pipeline/runtime";
import type { ExecuteStartSharedState } from "../../pipeline/executeStartEarlyPipeline";

export type MediumTaskListGateResult =
  | { kind: "continue" }
  | { kind: "terminal"; result: AgentRunResult };

export async function applyPostPlanTaskListGate(params: {
  runtime: AgentEngineRuntime;
  mediumOrLarge: boolean;
  mode: string;
  plan: PlanArtifact;
  planStrategy?: PlanStrategyDecision;
  seed: ExecutionSeed | undefined;
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  syncTaskListOnce: () => void;
  bus: EventBus;
  runId: string;
  input: AgentEngineStartInput;
  decision: ExecutionDecision;
  budget: RunBudgetTracker;
  startedMs: number;
  finish: (partial: {
    status: AgentRunResult["status"];
    route?: AgentRunResult["route"];
    planningDepth?: AgentRunResult["planningDepth"];
    answer?: string;
    plan?: AgentRunResult["plan"];
    suspension?: AgentRunResult["suspension"];
    reasonCodes?: AgentReasonCode[];
  }) => AgentRunResult;
}): Promise<MediumTaskListGateResult> {
  const {
    runtime,
    mediumOrLarge,
    mode,
    plan,
    planStrategy,
    seed,
    shared,
    taskListRef,
    reasonCodes,
    warnings,
    syncTaskListOnce,
    bus,
    runId,
    input,
    decision,
    budget,
    startedMs,
    finish,
  } = params;

  if (!(mediumOrLarge && mode === "agent")) {
    syncTaskListOnce();
    const seededAfterPlan = applyExecutionSeedToTaskList({
      taskList: taskListRef.current,
      seed,
    });
    if (seededAfterPlan.applied && seededAfterPlan.taskList) {
      taskListRef.current = seededAfterPlan.taskList;
      reasonCodes.push("execution_seed_task_list_bound");
    }
    return { kind: "continue" };
  }

  const ensured = ensureConcreteTaskListFromPlan({
    plan,
    seed,
    maxTasks: taskListRef.maxTasks,
    allowSeedRecovery: true,
  });
  shared.runPlan = ensured.plan;
  if (ensured.recovered) {
    warnings.push(
      "Recovered Change step targetRefs from trusted execution seed once.",
    );
  }
  if (ensured.seedBound) {
    reasonCodes.push("execution_seed_task_list_bound");
  }
  if (ensured.concrete && ensured.taskList) {
    taskListRef.current = ensured.taskList;
    runtime.emitTaskListUpdated(bus, runId, ensured.taskList);
    reasonCodes.push("task_list_seeded");
    return { kind: "continue" };
  }

  reasonCodes.push("task_list_plan_not_concrete");
  const rationale =
    "Plan did not yield a concrete file-scoped task list after bounded seed recovery. Clarify the change surface or replan before execute.";
  warnings.push(rationale);
  if (runtime.deps.checkpointStore) {
    await runtime.deps.checkpointStore.save({
      runId,
      requestId: shared.requestId,
      suspensionKind: "clarification_required",
      input,
      decision,
      pinnedState: undefined,
      messages: [],
      toolCacheEntries: [],
      pendingApproval: undefined,
      plan: ensured.plan,
      ...(planStrategy ? { planStrategy } : {}),
      changedFiles: [],
      mutationCheckpointIds: [],
      reasonCodes,
      warnings,
      usage: budget.snapshot(),
      startedAtMs: startedMs,
      repoBuildStateBefore: shared.repoBuildStateBefore,
      repoBuildStateAfter: shared.repoBuildStateAfter,
    });
  }
  runtime.emit(bus, {
    type: "suspended",
    runId,
    kind: "clarification_required",
    rationale,
    at: runtime.isoNow(),
  });
  await runtime.safeUnpin(runId, shared.pinnedState);
  return {
    kind: "terminal",
    result: finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      plan: ensured.plan,
      answer: rationale,
      suspension: {
        kind: "clarification_required",
        rationale,
        clarificationPrompt: rationale,
      },
      reasonCodes,
    }),
  };
}
