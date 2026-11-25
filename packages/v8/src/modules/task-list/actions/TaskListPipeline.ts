import type { PlanArtifact } from "../../planning";

import {
  applyTaskListUpdate,
  createDiscoveryTaskList,
  deriveTaskListFromPlan,
  refillTaskListFromPlan,
} from "./steps";
import type { TaskList } from "../types";
import {
  TASK_LIST_MESSAGES,
  TASK_LIST_REASON,
  TASK_LIST_SCHEMA_VERSION,
  TASK_LIST_STAGES,
} from "../constants";
import {
  TaskListError,
  noopModuleLogger,
  taskListApplyInputSchema,
  taskListApplyResultSchema,
  type ModuleLoggerPort,
  type TaskListApplyInput,
  type TaskListApplyResult,
} from "../types";

export type TaskListPipelineDependencies = {
  log?: ModuleLoggerPort;
};

/**
 * Task-list facade.
 *
 * Flow:
 *   1-apply-update | 2-create-discovery | 3-derive-from-plan | 4-refill-from-plan
 *
 * Owns compact live checklists for a run. Does not execute tools, persist
 * files, or own UI.
 */
export class TaskListPipeline {
  private readonly log: ModuleLoggerPort;

  constructor(deps: TaskListPipelineDependencies = {}) {
    this.log = deps.log ?? noopModuleLogger;
  }

  public apply(input: TaskListApplyInput): TaskListApplyResult {
    const startedMs = Date.now();
    let parsed: TaskListApplyInput;
    try {
      parsed = taskListApplyInputSchema.parse(input);
    } catch (error) {
      throw new TaskListError("invalid_input", TASK_LIST_MESSAGES.applyInputInvalid, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const result = applyTaskListUpdate(parsed);
    this.log.stage({
      module: "task-list",
      stage: TASK_LIST_STAGES.apply,
      durationMs: Date.now() - startedMs,
      reasonCodes: result.reasonCodes,
      inputSummary: {
        operation: parsed.operation.type,
        source: parsed.source,
        currentCount: parsed.current?.items.length ?? 0,
      },
      outputSummary: {
        status: result.status,
        itemCount: result.taskList?.items.length ?? 0,
      },
    });
    return result;
  }

  public createDiscoveryList(title?: string): TaskList {
    const startedMs = Date.now();
    const list = createDiscoveryTaskList(title);
    this.log.stage({
      module: "task-list",
      stage: TASK_LIST_STAGES.createDiscovery,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      outputSummary: {
        itemCount: list.items.length,
        purpose: list.purpose,
      },
    });
    return list;
  }

  public deriveFromPlan(
    plan: PlanArtifact,
    maxTasks?: number,
  ): TaskListApplyResult {
    const startedMs = Date.now();
    let result: TaskListApplyResult;
    try {
      result = deriveTaskListFromPlan(plan, maxTasks);
    } catch (error) {
      result = taskListApplyResultSchema.parse({
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        status: "rejected",
        warnings: [
          error instanceof Error
            ? error.message
            : TASK_LIST_MESSAGES.deriveFailed,
        ],
        reasonCodes: [TASK_LIST_REASON.invalid],
      });
    }
    this.log.stage({
      module: "task-list",
      stage: TASK_LIST_STAGES.deriveFromPlan,
      durationMs: Date.now() - startedMs,
      reasonCodes: result.reasonCodes,
      inputSummary: {
        maxTasks,
        phaseCount: plan.phases.length,
      },
      outputSummary: {
        status: result.status,
        itemCount: result.taskList?.items.length ?? 0,
      },
    });
    return result;
  }

  public refillFromPlan(
    current: TaskList,
    plan: PlanArtifact,
    maxTasks?: number,
    completedStepIds?: readonly string[],
  ): TaskListApplyResult {
    const startedMs = Date.now();
    let result: TaskListApplyResult;
    try {
      result = refillTaskListFromPlan({
        current,
        plan,
        maxTasks,
        completedStepIds,
      });
    } catch (error) {
      result = taskListApplyResultSchema.parse({
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        status: "rejected",
        warnings: [
          error instanceof Error
            ? error.message
            : TASK_LIST_MESSAGES.refillFailed,
        ],
        reasonCodes: [TASK_LIST_REASON.invalid],
      });
    }
    this.log.stage({
      module: "task-list",
      stage: TASK_LIST_STAGES.refillFromPlan,
      durationMs: Date.now() - startedMs,
      reasonCodes: result.reasonCodes,
      inputSummary: {
        currentCount: current.items.length,
        maxTasks,
        completedStepIds: completedStepIds?.length ?? 0,
      },
      outputSummary: {
        status: result.status,
        itemCount: result.taskList?.items.length ?? 0,
      },
    });
    return result;
  }
}
