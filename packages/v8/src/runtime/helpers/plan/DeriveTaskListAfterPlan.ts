/**
 * S3A-TASKLIST — 1:1 derive execution TaskList from PlanArtifact;
 * discovery temp list for readonly recon.
 * Module owns pipelines; runtime only invokes TaskListPipeline.
 */

import type { PlanArtifact } from "../../../modules/planning";
import {
  TaskListPipeline,
  type TaskList,
} from "../../../modules/task-list";

export interface DeriveTaskListAfterPlanResult {
  taskList?: TaskList;
  status: "applied" | "rejected" | "skipped";
  reasonCodes: string[];
}

const pipeline = new TaskListPipeline();

export function deriveTaskListAfterPlan(input: {
  plan?: PlanArtifact;
  maxTasks?: number;
}): DeriveTaskListAfterPlanResult {
  if (!input.plan) {
    return {
      status: "skipped",
      reasonCodes: ["tasklist_derive_skipped_no_plan"],
    };
  }
  const result = pipeline.deriveFromPlan(input.plan, input.maxTasks);
  if (result.status !== "applied" || !result.taskList) {
    return {
      status: "rejected",
      reasonCodes: [
        "tasklist_derive_rejected",
        ...result.reasonCodes.map(String),
      ],
    };
  }
  return {
    taskList: result.taskList,
    status: "applied",
    reasonCodes: [
      "tasklist_derive_applied",
      ...result.reasonCodes.map(String),
    ],
  };
}

export function beginDiscoveryTaskList(title?: string): {
  taskList: TaskList;
  reasonCodes: string[];
} {
  return {
    taskList: pipeline.createDiscoveryList(title),
    reasonCodes: ["tasklist_discovery_begun"],
  };
}

function isDiscoveryList(taskList: TaskList | undefined): boolean {
  if (!taskList) return false;
  return taskList.purpose === "discovery" || taskList.source === "discovery";
}

export function replaceDiscoveryWithExecution(input: {
  current?: TaskList;
  plan?: PlanArtifact;
  maxTasks?: number;
}): DeriveTaskListAfterPlanResult {
  if (input.current && !isDiscoveryList(input.current)) {
    return {
      taskList: input.current,
      status: "skipped",
      reasonCodes: ["tasklist_keep_execution"],
    };
  }
  return deriveTaskListAfterPlan({
    plan: input.plan,
    maxTasks: input.maxTasks,
  });
}
