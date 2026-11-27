/**
 * S3A-TASKLIST — 1:1 derive execution TaskList from PlanArtifact;
 * discovery temp list for readonly recon.
 * Module owns pipelines; runtime only invokes TaskListPipeline.
 */

import type { PlanArtifact } from "../../../modules/planning";
import {
  DEFAULT_MAX_TASK_TITLE_CHARS,
  TASK_LIST_SCHEMA_VERSION,
  taskListSchema,
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

/**
 * Generic multi-slice execution checklist from the user objective when plan
 * draft is hollow — keeps Continue / progress navigation alive.
 * Titles come from the objective text only — never canned English fillers.
 */
export function seedExecutionTaskListFromObjective(objective: string): {
  taskList: TaskList;
  reasonCodes: string[];
} {
  const titles = extractObjectiveSliceTitles(objective);
  const items = titles.slice(0, 8).map((title, index) => ({
    id: `slice_${index + 1}`,
    title: title.slice(0, DEFAULT_MAX_TASK_TITLE_CHARS),
    status: (index === 0 ? "active" : "pending") as "active" | "pending",
  }));
  return {
    taskList: taskListSchema.parse({
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "agent",
      purpose: "execution",
      title: "Campaign checklist",
      items,
    }),
    reasonCodes: ["tasklist_seeded_from_objective"],
  };
}

function extractObjectiveSliceTitles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return ["Complete requested work"];
  }

  const titles: string[] = [];
  for (const raw of trimmed.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(/^#{1,3}\s+(.+)$/)?.[1]?.trim();
    const numbered = line.match(/^\d+[\.)]\s+(.+)$/)?.[1]?.trim();
    const boldBullet = line.match(/^[-*]\s+\*\*(.+?)\*\*/)?.[1]?.trim();
    const plainBullet = line.match(/^[-*]\s+(.+)$/)?.[1]?.trim();
    const hit = header || numbered || boldBullet || plainBullet;
    if (hit && hit.length >= 4 && hit.length <= DEFAULT_MAX_TASK_TITLE_CHARS) {
      titles.push(hit.replace(/\s+/g, " "));
    }
  }
  if (titles.length >= 2) return [...new Set(titles)].slice(0, 8);

  // Single concrete slice from the first sentence / line of the ask.
  const firstLine = trimmed.split(/\n/).find((line) => line.trim().length >= 4);
  const sentence =
    firstLine?.replace(/\s+/g, " ").trim().slice(0, DEFAULT_MAX_TASK_TITLE_CHARS) ??
    "Complete requested work";
  return [sentence, "Verify and finish remaining work"];
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
