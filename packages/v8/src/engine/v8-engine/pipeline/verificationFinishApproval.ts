import type { ExecutionDecision } from "../../../modules/decision-policy";
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
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";

export async function finishIfApprovalRequired(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    requestId: string;
    input: AgentEngineStartInput;
    decision: ExecutionDecision;
    bus: EventBus;
    pinnedState: RepositoryStateReference | undefined;
    currentOutcome: Extract<ToolLoopOutcome, { kind: "approval_required" }>;
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
    repoBuildStateAfter?: RepoBuildState;
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
  } = params;

    if (!runtime.deps.checkpointStore) {
      await runtime.safeUnpin(runId, pinnedState);
      reasonCodes.push("misconfigured");
      return finish({
        status: "failed",
        reasonCodes,
        error: {
          code: "misconfigured",
          message: "Approval suspend requires a checkpoint store.",
        },
      });
    }

    reasonCodes.push("approval_suspended");
    await runtime.deps.checkpointStore.save({
      runId,
      requestId,
      ...(runtime.contextEpochs.get(runId)
        ? { contextEpoch: runtime.contextEpochs.get(runId) }
        : {}),
      suspensionKind: "approval_required",
      input,
      decision,
      pinnedState,
      messages: currentOutcome.messages,
      toolCacheEntries: currentOutcome.toolCache.entries(),
      pendingApproval: currentOutcome.pendingApproval,
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
    });

    const rationale = `Approval required for "${currentOutcome.pendingApproval.toolName}".`;
    runtime.emit(bus, {
      type: "suspended",
      runId,
      kind: "approval_required",
      rationale,
      at: runtime.isoNow(),
    });

    // Keep the repository state pinned across suspension so resume can
    // continue against the same pinned snapshot.
    return finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      suspension: {
        kind: "approval_required",
        rationale,
        approval: {
          approvalId: currentOutcome.pendingApproval.approvalId,
          fingerprint: currentOutcome.pendingApproval.fingerprint,
          toolName: currentOutcome.pendingApproval.toolName,
          callId: currentOutcome.pendingApproval.callId,
          paths: currentOutcome.pendingApproval.paths,
          arguments: currentOutcome.pendingApproval.arguments,
        },
      },
      reasonCodes,
    });
}
