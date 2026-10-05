import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { PlanArtifact } from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";

import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ExecutionSeed } from "../modules/execution-seed";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";

type FinishFn = (partial: {
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

type Common = {
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
  finish: FinishFn;
  taskListRef: TaskListRef;
  repoBuildStateBefore?: RepoBuildState;
  repoBuildStateAfter?: RepoBuildState;
  /** Refined seed to persist across Continue so resume does not drop binding. */
  executionSeed?: ExecutionSeed;
};

export async function finishIfGrantExpansionRequired(
  runtime: AgentEngineRuntime,
  params: Common & {
    currentOutcome: Extract<ToolLoopOutcome, { kind: "grant_expansion_required" }>;
    plan?: PlanArtifact;
  },
): Promise<AgentRunResult> {
  const {
    runId,
    requestId,
    input,
    decision,
    bus,
    pinnedState,
    currentOutcome,
    reasonCodes,
    warnings,
    budget,
    startedAtMs,
    finish,
    taskListRef,
    repoBuildStateBefore,
    plan,
  } = params;

    if (!runtime.deps.checkpointStore) {
      await runtime.safeUnpin(runId, pinnedState);
      reasonCodes.push("misconfigured");
      return finish({
        status: "failed",
        reasonCodes,
        error: {
          code: "misconfigured",
          message: "Grant expansion suspend requires a checkpoint store.",
        },
      });
    }

    const expansionId = runtime.deps.idGenerator.next("gexp");
    reasonCodes.push("grant_expansion_suspended");
    await runtime.deps.checkpointStore.save({
      runId,
      requestId,
      ...(runtime.contextEpochs.get(runId)
        ? { contextEpoch: runtime.contextEpochs.get(runId) }
        : {}),
      suspensionKind: "grant_expansion_required",
      input,
      decision,
      pinnedState,
      messages: currentOutcome.messages,
      toolCacheEntries: currentOutcome.toolCache.entries(),
      pendingGrantExpansion: {
        expansionId,
        extraPaths: [...currentOutcome.extraPaths],
        ...(currentOutcome.externalRoots &&
        currentOutcome.externalRoots.length > 0
          ? { externalRoots: [...currentOutcome.externalRoots] }
          : {}),
        ...(currentOutcome.pendingToolCalls &&
        currentOutcome.pendingToolCalls.length > 0
          ? { pendingToolCalls: [...currentOutcome.pendingToolCalls] }
          : {}),
      },
      changedFiles: currentOutcome.changedFiles,
      mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
      reasonCodes,
      warnings,
      usage: budget.snapshot(),
      startedAtMs,
      excludedWaitMs: budget.getExcludedWaitMs(),
      suspendedAtMs: Date.now(),
      repoBuildStateBefore,
      repoBuildStateAfter: params.repoBuildStateAfter,
      ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
      ...(taskListRef.completedPlanStepIds &&
      taskListRef.completedPlanStepIds.length > 0
        ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
        : {}),
      ...(plan ? { plan } : {}),
    });

    const allPreview = [
      ...currentOutcome.extraPaths,
      ...(currentOutcome.externalRoots ?? []),
    ];
    const pathPreview = allPreview.slice(0, 5).join(", ");
    const more =
      allPreview.length > 5 ? ` (+${allPreview.length - 5} more)` : "";
    const rationale =
      (currentOutcome.externalRoots?.length ?? 0) > 0
        ? `Access outside the workspace requires permission for: ${pathPreview}${more}.`
        : `Workspace access expansion required for: ${pathPreview}${more}.`;
    runtime.emit(bus, {
      type: "suspended",
      runId,
      kind: "grant_expansion_required",
      rationale,
      at: runtime.isoNow(),
    });

    return finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      suspension: {
        kind: "grant_expansion_required",
        rationale,
        grantExpansion: {
          expansionId,
          extraPaths: currentOutcome.extraPaths.slice(0, 50),
          ...(currentOutcome.externalRoots &&
          currentOutcome.externalRoots.length > 0
            ? {
                externalRoots: currentOutcome.externalRoots.slice(0, 20),
              }
            : {}),
          currentPathScopes: decision.toolGrant.pathScopes.slice(0, 20),
        },
      },
      reasonCodes,
    });
}

export async function finishIfContinueRequired(
  runtime: AgentEngineRuntime,
  params: Common & {
    currentOutcome: Extract<ToolLoopOutcome, { kind: "continue_required" }>;
    afterState?: RepoBuildState;
    plan?: PlanArtifact;
  },
): Promise<AgentRunResult> {
  const {
    runId,
    requestId,
    input,
    decision,
    bus,
    pinnedState,
    currentOutcome,
    reasonCodes,
    warnings,
    budget,
    startedAtMs,
    finish,
    taskListRef,
    repoBuildStateBefore,
    repoBuildStateAfter,
    afterState,
    plan,
    executionSeed,
  } = params;

    if (!runtime.deps.checkpointStore) {
      await runtime.safeUnpin(runId, pinnedState);
      if (currentOutcome.wallReason === "budget_exhausted") {
        reasonCodes.push("budget_exhausted");
        return finish({
          status: "budget_exhausted",
          answer: currentOutcome.answer || undefined,
          reasonCodes,
          error: {
            code: "budget_exhausted",
            message: currentOutcome.rationale,
          },
        });
      }
      reasonCodes.push("misconfigured");
      return finish({
        status: "failed",
        reasonCodes,
        error: {
          code: "misconfigured",
          message: "Continue suspend requires a checkpoint store.",
        },
      });
    }

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
      messages: currentOutcome.messages,
      toolCacheEntries: currentOutcome.toolCache.entries(),
      changedFiles: currentOutcome.changedFiles,
      mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
      stallContinueRationale: currentOutcome.rationale,
      continuePartialAnswer: currentOutcome.answer || undefined,
      continueWallReason: currentOutcome.wallReason,
      continueOverrideCount: currentOutcome.continueOverrideCount,
      reasonCodes,
      warnings,
      usage: budget.snapshot(),
      startedAtMs,
      excludedWaitMs: budget.getExcludedWaitMs(),
      suspendedAtMs: Date.now(),
      repoBuildStateBefore,
      repoBuildStateAfter: afterState ?? repoBuildStateAfter,
      ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
      ...(taskListRef.completedPlanStepIds &&
      taskListRef.completedPlanStepIds.length > 0
        ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
        : {}),
      ...(plan ? { plan: plan } : {}),
      ...(executionSeed ? { executionSeed } : {}),
    });

    runtime.emit(bus, {
      type: "suspended",
      runId,
      kind: "continue_required",
      rationale: currentOutcome.rationale,
      at: runtime.isoNow(),
    });

    return finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      answer: currentOutcome.answer || undefined,
      suspension: {
        kind: "continue_required",
        rationale: currentOutcome.rationale,
        continuePrompt: currentOutcome.rationale,
      },
      reasonCodes,
    });
}
