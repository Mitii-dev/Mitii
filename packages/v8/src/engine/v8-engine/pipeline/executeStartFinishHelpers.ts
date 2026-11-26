/**
 * Start-path finish / cancel / task-list sync helpers for executeV8Start.
 */
import {
  applyExplorationSignal,
  toRunUsage,
  finalizeRunEvidence,
} from "../actions";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../legacy/constants";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import { persistVerificationArtifact } from "./verification";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipelineTypes";
import { parseAgentRunResultResilient } from "./parseAgentRunResult";

export function createExecuteStartFinishers(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  runEvidence: RunEvidence;
  taskListRef: TaskListRef;
  planSource?: "host_carry" | "resume_approval";
  getCancelReason: () => string | undefined;
}): {
  syncTaskListOnce: () => void;
  finish: (
    partial: Omit<
      AgentRunResult,
      | "schemaVersion"
      | "runId"
      | "requestId"
      | "usage"
      | "durationMs"
      | "warnings"
      | "reasonCodes"
    > & {
      reasonCodes?: AgentReasonCode[];
      warnings?: string[];
    },
  ) => AgentRunResult;
  cancelledResult: () => Promise<AgentRunResult>;
} {
  const {
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
  } = params;

  let taskListSynced = false;
  const syncTaskListOnce = () => {
    const replacingDiscovery =
      taskListRef.current?.purpose === "discovery" ||
      taskListRef.current?.source === "discovery";
    if (taskListSynced && !replacingDiscovery) return;
    taskListSynced = true;
    runtime.syncTaskList({
      mode: input.request.mode,
      plan: shared.runPlan,
      planningDepth: shared.planningDepth,
      planSource,
      taskListRef,
      runId,
      bus,
      reasonCodes,
      resetExisting: planSource === "resume_approval" || replacingDiscovery,
    });
  };

  const finish = (
    partial: Omit<
      AgentRunResult,
      | "schemaVersion"
      | "runId"
      | "requestId"
      | "usage"
      | "durationMs"
      | "warnings"
      | "reasonCodes"
    > & {
      reasonCodes?: AgentReasonCode[];
      warnings?: string[];
    },
  ): AgentRunResult => {
    const usageSnap = budget.snapshot();
    const finalReasonCodes = [...(partial.reasonCodes ?? reasonCodes)];
    const finalWarnings = [...warnings, ...(partial.warnings ?? [])];
    applyExplorationSignal(usageSnap, finalReasonCodes, finalWarnings);
    const result = parseAgentRunResultResilient({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId,
      requestId: shared.requestId,
      status: partial.status,
      route: partial.route ?? shared.route,
      planningDepth: partial.planningDepth ?? shared.planningDepth,
      answer: partial.answer,
      plan: partial.plan ?? shared.runPlan,
      ...(partial.planStrategy ?? shared.runPlanStrategy
        ? { planStrategy: partial.planStrategy ?? shared.runPlanStrategy }
        : {}),
      ...(input.request.mode !== "ask" &&
      (partial.taskList ?? taskListRef.current)
        ? { taskList: partial.taskList ?? taskListRef.current }
        : {}),
      repoBuildStateBefore: shared.repoBuildStateBefore,
      repoBuildStateAfter: shared.repoBuildStateAfter,
      ...(shared.verificationRecord
        ? { verificationRecord: shared.verificationRecord }
        : {}),
      evidence: finalizeRunEvidence({
        evidence: runEvidence,
        status: partial.status,
        reasonCodes: finalReasonCodes,
      }),
      suspension: partial.suspension,
      pinnedState: partial.pinnedState ?? shared.pinnedState,
      ...(partial.sessionControl
        ? { sessionControl: partial.sessionControl }
        : {}),
      reasonCodes: finalReasonCodes,
      warnings: finalWarnings,
      usage: toRunUsage(usageSnap),
      durationMs: Date.now() - startedMs,
      error: partial.error,
    });

    runtime.emit(bus, {
      type: "terminal",
      runId,
      status: result.status,
      result,
      at: runtime.isoNow(),
    });
    return result;
  };

  const cancelledResult = async (): Promise<AgentRunResult> => {
    shared.verificationRecord =
      (await persistVerificationArtifact(runtime, {
        runId,
        requestId: shared.requestId,
        workspaceId: resolveWorkspaceId(input),
        bus,
        reasonCodes,
        warnings,
        status: "cancelled",
        before: shared.repoBuildStateBefore,
        after: shared.repoBuildStateAfter,
        previous: shared.verificationRecord,
        logVerbosity: input.logVerbosity,
      })) ?? shared.verificationRecord;
    return finish({
      status: "cancelled",
      reasonCodes: [...reasonCodes, "cancelled"],
      error: {
        code: "cancelled",
        message: getCancelReason() ?? "Run cancelled.",
      },
    });
  };

  return { syncTaskListOnce, finish, cancelledResult };
}
