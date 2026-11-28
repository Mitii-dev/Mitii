/**
 * Enrichment tail: skills → memory → planning → seed bind.
 * Phase bodies live in enrichmentSkillsMemory / enrichmentPlanning.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type { PromptRepositoryContext } from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import { applyExecutionSeedToTaskList } from "../modules/execution-seed";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";
import { retrieveEnrichmentSkillsAndMemory } from "./enrichmentSkillsMemory";
import { runEnrichmentPlanning } from "./enrichmentPlanning";

export async function finishEnrichmentSkillsMemoryPlan(
  runtime: AgentEngineRuntime,
  params: {
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
    runEvidence: RunEvidence;
    syncTaskListOnce: () => void;
    envelope: UserRequestEnvelope;
    candidateRelativePaths: string[];
    approvedPlan?: PlanArtifact;
    approvedPlanStrategy?: PlanStrategyDecision;
    skipPlanGate: boolean;
    planSource?: "host_carry" | "resume_approval";
    finish: (partial: {
      status: AgentRunStatus;
      route?: AgentRunResult["route"];
      planningDepth?: AgentRunResult["planningDepth"];
      answer?: string;
      plan?: AgentRunResult["plan"];
      suspension?: AgentRunResult["suspension"];
      pinnedState?: import("../../../modules/repository-state").RepositoryStateReference;
      reasonCodes?: AgentReasonCode[];
      warnings?: string[];
      error?: { code: string; message: string };
    }) => AgentRunResult;
    cancelledResult: () => Promise<AgentRunResult>;
    understanding: RequestUnderstandingResult;
    decision: ExecutionDecision;
    repositoryContext: PromptRepositoryContext | undefined;
    contextPaths: string[];
  },
): Promise<StartEnrichmentOutcome> {
  const {
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    runEvidence,
    syncTaskListOnce,
    envelope,
    candidateRelativePaths,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate,
    planSource,
    finish,
    cancelledResult,
    repositoryContext,
    contextPaths,
    understanding,
    decision,
  } = params;

  const { selectedSkills, skillCatalogL1, selectedMemory } =
    await retrieveEnrichmentSkillsAndMemory({
      runtime,
      runId,
      input,
      bus,
      windowPolicy,
      reasonCodes,
      warnings,
      envelope,
      understanding,
      decision,
      contextPaths,
      signal,
    });

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  const planning = await runEnrichmentPlanning({
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    runEvidence,
    syncTaskListOnce,
    envelope,
    candidateRelativePaths,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate,
    planSource,
    finish,
    understanding,
    decision,
    repositoryContext,
    contextPaths,
    selectedSkills,
  });
  if (planning.terminal) {
    return planning.terminal;
  }

  syncTaskListOnce();
  const seededTaskList = applyExecutionSeedToTaskList({
    taskList: taskListRef.current,
    seed: shared.executionSeed,
  });
  if (seededTaskList.applied && seededTaskList.taskList) {
    taskListRef.current = seededTaskList.taskList;
    reasonCodes.push("execution_seed_task_list_bound");
  }

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  return {
    kind: "continue",
    state: {
      envelope,
      understanding,
      decision,
      repositoryContext,
      selectedSkills,
      skillCatalogL1,
      selectedMemory,
      planText: planning.planText,
    },
  };
}
