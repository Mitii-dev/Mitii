import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import {
  clampRunBudget,
  createInitialRunEvidence,
  isProviderInfrastructureFailure,
} from "../actions";
import { agentRunBudgetSchema } from "../contracts";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";

import type { AgentEngineRuntime } from "./runtime";
import {
  runStartEarlyPipeline,
  type ExecuteStartSharedState,
} from "./executeStartEarlyPipeline";
import { runStartEnrichment } from "./executeStartEnrichment";
import { createExecuteStartFinishers } from "./executeStartFinishHelpers";
import { runStartPromptAndLoop } from "./executeStartPromptAndLoop";
import type { StartReuseState } from "./startReuse";
import { emitRunBudgetClampWarnings } from "./emitRunBudgetClampWarnings";

/**
 * V8 start path: early + enrichment (legacy modules) → thin model/tool loop.
 * Never arms mutation-lock / preflight-repair steering into the loop.
 */
export async function executeV8Start(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    input: AgentEngineStartInput;
    bus: EventBus;
    signal: AbortSignal;
    getCancelReason: () => string | undefined;
    approvedPlan?: PlanArtifact;
    approvedPlanStrategy?: PlanStrategyDecision;
    skipPlanGate?: boolean;
    planSource?: "host_carry" | "resume_approval";
    reuse?: StartReuseState;
  },
): Promise<AgentRunResult> {
  const {
    runId,
    input,
    bus,
    signal,
    getCancelReason,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate = false,
    planSource,
    reuse,
  } = params;
  const startedMs = Date.now();
  const windowPolicy = runtime.resolveWindowPolicy(input);
  const runBudgetClamp = clampRunBudget(
    agentRunBudgetSchema.parse(input.budget ?? {}),
    windowPolicy,
  );
  const budget = new RunBudgetTracker(runBudgetClamp.budget, startedMs);
  const reasonCodes: AgentReasonCode[] = ["run_started"];
  const warnings: string[] = [];

  emitRunBudgetClampWarnings(runtime, {
    runId,
    bus,
    clamped: runBudgetClamp.clamped,
    logVerbosity: input.logVerbosity,
  });

  const shared: ExecuteStartSharedState = {
    pinnedState: undefined,
    requestId: input.request.requestId ?? runId,
    route: undefined,
    planningDepth: undefined,
    runPlan: undefined,
    runPlanStrategy: undefined,
    repoBuildStateBefore: undefined,
    repoBuildStateAfter: undefined,
    verificationRecord: undefined,
  };
  const runEvidence = createInitialRunEvidence(input.request.userMessage);
  const taskListRef: TaskListRef = {
    current:
      input.request.mode === "ask" || planSource === "resume_approval"
        ? undefined
        : input.taskList,
    maxTasks: windowPolicy.taskList.maxTasks,
    completedPlanStepIds: [],
  };
  const { syncTaskListOnce, finish, cancelledResult } =
    createExecuteStartFinishers({
      runtime,
      runId,
      input,
      bus,
      budget,
      reasonCodes,
      warnings,
      startedMs,
      shared,
      runEvidence,
      taskListRef,
      planSource,
      getCancelReason,
    });

  try {
    if (signal.aborted) {
      return await cancelledResult();
    }

    const early = await runStartEarlyPipeline(runtime, {
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
      finish,
      cancelledResult,
      reuse,
    });
    if (early.kind === "terminal") {
      return early.result;
    }

    const enrichment = await runStartEnrichment(runtime, {
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
      envelope: early.state.envelope,
      understanding: early.state.understanding,
      decision: early.state.decision,
      candidateRelativePaths: early.state.candidateRelativePaths,
      approvedPlan,
      approvedPlanStrategy,
      skipPlanGate,
      planSource,
      finish,
      cancelledResult,
    });
    if (enrichment.kind === "terminal") {
      return enrichment.result;
    }

    return await runStartPromptAndLoop({
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
      envelope: enrichment.state.envelope,
      understanding: enrichment.state.understanding,
      decision: enrichment.state.decision,
      repositoryContext: enrichment.state.repositoryContext,
      selectedSkills: enrichment.state.selectedSkills,
      skillCatalogL1: enrichment.state.skillCatalogL1,
      selectedMemory: enrichment.state.selectedMemory,
      planText: enrichment.state.planText,
      finish,
      cancelledResult,
    });
  } catch (error) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    if (signal.aborted) {
      return await cancelledResult();
    }
    const message =
      error instanceof Error ? error.message : "Agent run failed.";
    const infrastructure = isProviderInfrastructureFailure({
      errorMessage: message,
    });
    return finish({
      status: "failed",
      reasonCodes: [
        ...reasonCodes,
        "provider_failed",
        ...(infrastructure
          ? (["provider_infrastructure_unavailable"] as const)
          : []),
      ],
      error: {
        code: infrastructure ? "provider_unavailable" : "execution_failed",
        message,
      },
    });
  }
}
