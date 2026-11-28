/**
 * Handle update_todos tool calls without Tool Runtime.
 */
import {
  serializeToolResultForModel,
  recordToolEvidence,
} from "../actions";
import {
  applyUpdateTodosArguments,
  buildUpdateTodosToolResult,
  isUpdateTodosTool,
  markTaskListUpdated,
  maybeRefillTaskListFromPlan,
  planProgressOf,
  recordCompletedPlanSteps,
} from "../internal/taskListRuntime";
import type { ToolCallOutcome } from "./types";
import { toolCompletionDiagnostics } from "./executeToolSupport";
import type { ExecuteToolContinueContext } from "./executeToolFinishTypes";
import type { AgentEngineRuntime } from "./runtime";

export function finishUpdateTodosTool(
  runtime: AgentEngineRuntime,
  ctx: ExecuteToolContinueContext,
): ToolCallOutcome | undefined {
  const {
    toolCall,
    argumentsValue,
    summary,
    taskListRef,
    windowPolicy,
    toolCache,
    budget,
    reasonCodes,
    bus,
    runId,
    evidence,
    plan,
  } = ctx;

  if (!isUpdateTodosTool(toolCall.name)) {
    return undefined;
  }

  const applied = applyUpdateTodosArguments({
    current: taskListRef?.current,
    argumentsValue,
    maxTasks: taskListRef?.maxTasks,
  });
  const result = applied.ok
    ? buildUpdateTodosToolResult({
        callId: toolCall.id,
        status: "succeeded",
        taskList: applied.taskList,
        warnings: applied.warnings,
      })
    : buildUpdateTodosToolResult({
        callId: toolCall.id,
        status: "rejected",
        reasonCode: "invalid_arguments",
        warnings: [applied.message],
      });
  if (applied.ok) {
    let nextList = applied.taskList;
    if (taskListRef && nextList) {
      const newlyDone = nextList.items.filter((item) => item.status === "done");
      recordCompletedPlanSteps(taskListRef, newlyDone);
    }
    if (nextList && plan) {
      const refilled = maybeRefillTaskListFromPlan({
        current: nextList,
        plan,
        maxTasks: taskListRef?.maxTasks,
        completedPlanStepIds: taskListRef?.completedPlanStepIds,
      });
      if (refilled.refilled && refilled.taskList) {
        nextList = refilled.taskList;
        reasonCodes.push("task_list_refilled");
      }
    }
    if (taskListRef) {
      taskListRef.current = nextList;
      markTaskListUpdated(taskListRef, budget.snapshot().modelCalls);
    }
    reasonCodes.push("task_list_updated");
    // Always emit, including clear/empty, so hosts can drop a stale checklist.
    runtime.emitTaskListUpdated(
      bus,
      runId,
      nextList ?? {
        schemaVersion: 1,
        source: "agent",
        items: [],
      },
      planProgressOf({
        plan,
        completedPlanStepIds: taskListRef?.completedPlanStepIds,
        evidence,
      }),
    );
  }
  toolCache.set(toolCall.id, result);
  runtime.emit(bus, {
    type: "tool_completed",
    runId,
    callId: toolCall.id,
    toolName: toolCall.name,
    status: result.status,
    ...(summary ? { summary } : {}),
    ...toolCompletionDiagnostics(result),
    at: runtime.isoNow(),
  });
  recordToolEvidence(evidence, {
    toolName: toolCall.name,
    status: result.status,
    summary,
    output: result.output,
    at: runtime.isoNow(),
  });
  return {
    kind: "message",
    message: {
      role: "tool",
      toolCallId: toolCall.id,
      content: serializeToolResultForModel(result, {
        maxContentChars: windowPolicy.compaction.toolResultContentChars,
      }),
    },
  };
}
