import type { PlanArtifact } from "../../planning";

import {
  applyTaskListUpdate,
  createDiscoveryTaskList,
  deriveTaskListFromPlan,
  refillTaskListFromPlan,
} from "../actions";
import type { TaskList } from "../contracts";
import { TASK_LIST_SCHEMA_VERSION } from "../constants";
import {
  TaskListError,
  taskListApplyInputSchema,
  taskListApplyResultSchema,
} from "../contracts";
import type {
  TaskListApplyInput,
  TaskListApplyResult,
} from "../contracts";

/**
 * Task-list facade.
 *
 * Owns compact live checklists for a run: replace, patch, clear, and
 * derive-from-plan. Does not execute tools, persist files, or own UI.
 */
export class TaskListPipeline {
  public apply(input: TaskListApplyInput): TaskListApplyResult {
    let parsed: TaskListApplyInput;
    try {
      parsed = taskListApplyInputSchema.parse(input);
    } catch (error) {
      throw new TaskListError(
        "invalid_input",
        "Task list apply input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
    return applyTaskListUpdate(parsed);
  }

  public createDiscoveryList(title?: string): TaskList {
    return createDiscoveryTaskList(title);
  }

  public deriveFromPlan(
    plan: PlanArtifact,
    maxTasks?: number,
  ): TaskListApplyResult {
    try {
      return deriveTaskListFromPlan(plan, maxTasks);
    } catch (error) {
      return taskListApplyResultSchema.parse({
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        status: "rejected",
        warnings: [
          error instanceof Error
            ? error.message
            : "Failed to derive a task list from the plan.",
        ],
        reasonCodes: ["task_list_invalid"],
      });
    }
  }

  public refillFromPlan(
    current: TaskList,
    plan: PlanArtifact,
    maxTasks?: number,
    completedStepIds?: readonly string[],
  ): TaskListApplyResult {
    try {
      return refillTaskListFromPlan({
        current,
        plan,
        maxTasks,
        completedStepIds,
      });
    } catch (error) {
      return taskListApplyResultSchema.parse({
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        status: "rejected",
        warnings: [
          error instanceof Error
            ? error.message
            : "Failed to refill the task list from the plan.",
        ],
        reasonCodes: ["task_list_invalid"],
      });
    }
  }
}
