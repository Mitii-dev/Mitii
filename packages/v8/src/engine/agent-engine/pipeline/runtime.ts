import { CharacterTokenEstimator } from "../../../modules/prompt-construction";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";
import type { PlanArtifact } from "../../../modules/planning";
import type { TaskList } from "../../../modules/task-list";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../../../modules/window-budget";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import type {
  AgentActiveStage,
  AgentEngineDependencies,
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunHandle,
  AgentRunResult,
  RunEvidence,
  RunEvent,
} from "../contracts";
import { AgentEngineError } from "../contracts";
import { EventBus } from "../internal/EventBus";
import { progressOf, planProgressOf, seedTaskListFromPlan, type TaskListRef } from "../internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../policy";

export type AgentEngineResolvedDeps = Required<
  Pick<
    AgentEngineDependencies,
    | "intake"
    | "understanding"
    | "decision"
    | "prompt"
    | "llm"
    | "clock"
    | "idGenerator"
  >
> &
  Pick<
    AgentEngineDependencies,
    | "skills"
    | "memory"
    | "planning"
    | "repositoryState"
    | "repositoryContext"
    | "tools"
    | "verification"
    | "checkpointStore"
    | "toolDefinitions"
    | "taskListAutoAdvance"
    | "repoGraphs"
  >;

export interface AgentEngineRuntime {
  readonly deps: AgentEngineResolvedDeps;
  readonly tokenEstimator: TokenEstimatorPort;
  emit(bus: EventBus, event: RunEvent): void;
  emitStage(
    bus: EventBus,
    runId: string,
    stage: AgentActiveStage,
    phase: "started" | "completed",
    reasonCodes?: AgentReasonCode[],
  ): void;
  emitTaskListUpdated(
    bus: EventBus,
    runId: string,
    taskList: TaskList,
    planProgress?: {
      planCompletedCount: number;
      planTotalCount: number;
      completedStepIds: string[];
    },
  ): void;
  emitEvidenceUpdated(
    bus: EventBus,
    runId: string,
    evidence: RunEvidence | undefined,
  ): void;
  emitRepoBuildStateCaptured(
    bus: EventBus,
    runId: string,
    state: RepoBuildState,
  ): void;
  isoNow(): string;
  safeUnpin(
    runId: string,
    state: RepositoryStateReference | undefined,
  ): Promise<void>;
  resolveWindowPolicy(input: AgentEngineStartInput): WindowPolicy;
  syncTaskList(params: {
    mode: string;
    plan?: PlanArtifact;
    planningDepth?: AgentRunResult["planningDepth"];
    planSource?: "host_carry" | "resume_approval";
    taskListRef: TaskListRef;
    runId: string;
    bus: EventBus;
    reasonCodes: AgentReasonCode[];
    resetExisting?: boolean;
  }): void;
}

export function resolveAgentEngineDeps(
  dependencies: AgentEngineDependencies,
): AgentEngineResolvedDeps {
  if (
    !dependencies.intake ||
    !dependencies.understanding ||
    !dependencies.decision ||
    !dependencies.prompt ||
    !dependencies.llm
  ) {
    throw new AgentEngineError(
      "misconfigured_ports",
      "AgentEnginePipeline requires intake, understanding, decision, prompt, and llm.",
    );
  }

  return {
    intake: dependencies.intake,
    understanding: dependencies.understanding,
    decision: dependencies.decision,
    prompt: dependencies.prompt,
    llm: dependencies.llm,
    skills: dependencies.skills,
    memory: dependencies.memory,
    planning: dependencies.planning,
    repositoryState: dependencies.repositoryState,
    repositoryContext: dependencies.repositoryContext,
    tools: dependencies.tools,
    verification: dependencies.verification,
    checkpointStore: dependencies.checkpointStore,
    repoGraphs: dependencies.repoGraphs,
    toolDefinitions: dependencies.toolDefinitions,
    taskListAutoAdvance: dependencies.taskListAutoAdvance,
    clock: dependencies.clock ?? { now: () => new Date() },
    idGenerator: dependencies.idGenerator ?? {
      next: (prefix: string) =>
        `${prefix}_${Math.random().toString(36).slice(2, 10)}`,
    },
  };
}

export function createAgentEngineRuntime(
  deps: AgentEngineResolvedDeps,
  tokenEstimator: TokenEstimatorPort = new CharacterTokenEstimator(),
): AgentEngineRuntime {
  const isoNow = (): string => deps.clock.now().toISOString();

  const emit = (bus: EventBus, event: RunEvent): void => {
    bus.push(event);
  };

  const emitStage = (
    bus: EventBus,
    runId: string,
    stage: AgentActiveStage,
    phase: "started" | "completed",
    reasonCodes?: AgentReasonCode[],
  ): void => {
    if (phase === "started") {
      emit(bus, {
        type: "stage_started",
        runId,
        stage,
        at: isoNow(),
      });
      return;
    }
    emit(bus, {
      type: "stage_completed",
      runId,
      stage,
      at: isoNow(),
      reasonCodes,
    });
  };

  const emitTaskListUpdated = (
    bus: EventBus,
    runId: string,
    taskList: TaskList,
    planProgress?: {
      planCompletedCount: number;
      planTotalCount: number;
      completedStepIds: string[];
    },
  ): void => {
    const progress = progressOf(taskList);
    emit(bus, {
      type: "task_list_updated",
      runId,
      source: taskList.source,
      completedCount: progress.completedCount,
      totalCount: progress.totalCount,
      ...(progress.activeId ? { activeId: progress.activeId } : {}),
      ...(planProgress && planProgress.planTotalCount > 0
        ? {
            planCompletedCount: planProgress.planCompletedCount,
            planTotalCount: planProgress.planTotalCount,
            completedPlanStepIds: planProgress.completedStepIds.slice(0, 80),
          }
        : {}),
      taskList,
      at: isoNow(),
    });
  };

  const emitEvidenceUpdated = (
    bus: EventBus,
    runId: string,
    evidence: RunEvidence | undefined,
  ): void => {
    if (!evidence) {
      return;
    }
    emit(bus, {
      type: "evidence_updated",
      runId,
      evidence,
      at: isoNow(),
    });
  };

  const emitRepoBuildStateCaptured = (
    bus: EventBus,
    runId: string,
    state: RepoBuildState,
  ): void => {
    emit(bus, {
      type: "repo_build_state_captured",
      runId,
      phase: state.phase,
      errorCount: state.summary.errorCount,
      warningCount: state.summary.warningCount,
      failedCheckIds: state.summary.failedCheckIds.slice(0, 16),
      projectIds: state.scope.projectIds.slice(0, 16),
      truncated:
        state.summary.failedCheckIds.length > 16 ||
        state.scope.projectIds.length > 16
          ? true
          : undefined,
      at: isoNow(),
    });
  };

  const safeUnpin = async (
    runId: string,
    state: RepositoryStateReference | undefined,
  ): Promise<void> => {
    if (!state || !deps.repositoryState) {
      return;
    }
    try {
      await deps.repositoryState.unpin({ state, runId });
    } catch {
      // Unpin is best-effort on terminal paths.
    }
  };

  const resolveWindowPolicy = (input: AgentEngineStartInput): WindowPolicy => {
    const tools =
      input.tools ?? deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS;
    const toolSchemaTokens =
      tools.length > 0 ? tokenEstimator.estimate(JSON.stringify(tools)) : 0;
    // Context window comes from llm capabilities (host settings). Max output
    // comes from the start-input host setting when provided; never from a
    // pre-derived capability number (that would become a false host override).
    const hostMaximumOutputTokens =
      input.windowBudget?.maximumOutputTokens !== undefined
        ? input.windowBudget.maximumOutputTokens
        : 0;
    return deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: deps.llm.capabilities.contextWindowTokens,
      maximumOutputTokens: hostMaximumOutputTokens,
      toolSchemaTokens,
      policy: input.windowBudget?.policy,
      effort: input.windowBudget?.effort,
    });
  };

  const syncTaskList = (params: {
    mode: string;
    plan?: PlanArtifact;
    planningDepth?: AgentRunResult["planningDepth"];
    planSource?: "host_carry" | "resume_approval";
    taskListRef: TaskListRef;
    runId: string;
    bus: EventBus;
    reasonCodes: AgentReasonCode[];
    resetExisting?: boolean;
  }): void => {
    const seeded = seedTaskListFromPlan({
      mode: params.mode,
      plan: params.plan,
      planningDepth: params.planningDepth,
      planSource: params.planSource,
      taskListRef: params.taskListRef,
      resetExisting: params.resetExisting,
    });
    // Do not invent Diagnose/Apply/Verify placeholders. Hosts show a list only
    // after derive-from-plan or the model creates one via update_todos.
    if (seeded.seeded) {
      params.reasonCodes.push("task_list_seeded");
    }
    if (params.taskListRef.current) {
      emitTaskListUpdated(
        params.bus,
        params.runId,
        params.taskListRef.current,
        planProgressOf({
          plan: params.plan,
          completedPlanStepIds: params.taskListRef.completedPlanStepIds,
        }),
      );
    }
  };

  return {
    deps,
    tokenEstimator,
    emit,
    emitStage,
    emitTaskListUpdated,
    emitEvidenceUpdated,
    emitRepoBuildStateCaptured,
    isoNow,
    safeUnpin,
    resolveWindowPolicy,
    syncTaskList,
  };
}

export function createRunHandle(
  runId: string,
  execute: (
    bus: EventBus,
    signal: AbortSignal,
    getCancelReason: () => string | undefined,
  ) => Promise<AgentRunResult>,
): AgentRunHandle {
  const bus = new EventBus();
  const abort = new AbortController();
  let cancelReason: string | undefined;

  const resultPromise = execute(bus, abort.signal, () => cancelReason).finally(
    () => {
      bus.end();
    },
  );

  return {
    runId,
    events: bus.asIterable(),
    result: resultPromise,
    cancel: (reason?: string) => {
      cancelReason = reason ?? "cancelled_by_caller";
      abort.abort();
    },
  };
}

export function resolveWorkspaceId(
  input: AgentEngineStartInput,
): string | undefined {
  return (
    input.request.workspace?.workspaceId ??
    input.repositoryState?.reference?.workspaceId
  );
}
