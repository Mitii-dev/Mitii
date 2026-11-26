/**
 * Auto-advance task list after a succeeded tool, with plan evidence marks.
 */
import type { ModelToolCall } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type { ToolResult } from "../../tool-runtime";

import { markPlanEvidenceStepsDone } from "../actions";
import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import {
  markTaskListUpdated,
  maybeAutoAdvanceTaskList,
  planProgressOf,
  type TaskListRef,
} from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";

export function maybeAutoAdvanceAfterSucceededTool(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  toolCall: ModelToolCall;
  result: ToolResult;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  taskListAutoAdvance: boolean;
  taskListAutoAdvanceBudget: { remaining: number };
  taskListRef?: TaskListRef;
  preToolActiveId: string | undefined;
  mutatingToolNames: ReadonlySet<string>;
  plan?: PlanArtifact;
  budget: RunBudgetTracker;
  evidence?: RunEvidence;
}): void {
  const {
    runtime,
    bus,
    runId,
    toolCall,
    result,
    reasonCodes,
    warnings,
    taskListAutoAdvance,
    taskListAutoAdvanceBudget,
    taskListRef,
    preToolActiveId,
    mutatingToolNames,
    plan,
    budget,
    evidence,
  } = params;

  const output = result.output as
    | { checkpointId?: string; changedFiles?: string[] }
    | undefined;

  const autoAdvanced = maybeAutoAdvanceTaskList({
    enabled: taskListAutoAdvance,
    allowAdvance: taskListAutoAdvanceBudget.remaining > 0,
    current: taskListRef?.current,
    preToolActiveId,
    toolStatus: result.status,
    isMutatingTool: mutatingToolNames.has(toolCall.name),
    changedFiles: output?.changedFiles ?? [],
    plan,
    maxTasks: taskListRef?.maxTasks,
    taskListRef,
  });
  if (autoAdvanced.warnings.length > 0) {
    warnings.push(...autoAdvanced.warnings);
  }
  if (autoAdvanced.advanced && autoAdvanced.taskList && taskListRef) {
    taskListRef.current = autoAdvanced.taskList;
    markTaskListUpdated(taskListRef, budget.snapshot().modelCalls);
    taskListAutoAdvanceBudget.remaining = Math.max(
      0,
      taskListAutoAdvanceBudget.remaining - 1,
    );
    reasonCodes.push("task_list_auto_advanced", "task_list_updated");
    if (autoAdvanced.handoff) {
      reasonCodes.push("task_handoff_recorded" as AgentReasonCode);
    }
    if (autoAdvanced.refilled) {
      reasonCodes.push("task_list_refilled");
    }
    runtime.emitTaskListUpdated(
      bus,
      runId,
      autoAdvanced.taskList,
      planProgressOf({
        plan,
        completedPlanStepIds: taskListRef.completedPlanStepIds,
        evidence,
      }),
    );
    if (evidence?.plan && autoAdvanced.completedStepIds) {
      markPlanEvidenceStepsDone(evidence, autoAdvanced.completedStepIds);
    }
  }
}
