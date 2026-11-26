import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";

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
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import { finishEnrichmentSkillsMemoryPlan } from "./executeStartEnrichmentTail";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";
import { runEnrichmentContext } from "./executeStartEnrichmentContext";

export type {
  StartEnrichmentContinue,
  StartEnrichmentOutcome,
} from "./executeStartEnrichmentTypes";

/** Context → Skills → Memory → Planning. */
export async function runStartEnrichment(
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
    understanding: RequestUnderstandingResult;
    decision: ExecutionDecision;
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
      pinnedState?: RepositoryStateReference;
      reasonCodes?: AgentReasonCode[];
      warnings?: string[];
      error?: { code: string; message: string };
    }) => AgentRunResult;
    cancelledResult: () => Promise<AgentRunResult>;
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
  } = params;

  const context = await runEnrichmentContext({
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    reasonCodes,
    warnings,
    shared,
    envelope,
    understanding: params.understanding,
    decision: params.decision,
    candidateRelativePaths,
    finish,
    cancelledResult,
  });
  if (context.kind === "terminal") {
    return context;
  }

  return finishEnrichmentSkillsMemoryPlan(runtime, {
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
    understanding: context.understanding,
    decision: context.decision,
    repositoryContext: context.repositoryContext,
    contextPaths: context.contextPaths,
  });
}
