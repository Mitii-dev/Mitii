import type { PlanArtifact } from "../../planning";

import { TASK_LIST_SCHEMA_VERSION } from "../constants";
import {
  DEFAULT_MAX_TASK_DETAIL_CHARS,
  DEFAULT_MAX_TASK_TITLE_CHARS,
} from "../defaults";
import { TASK_LIST_POLICY } from "../policy";
import type { TaskItem, TaskListApplyResult } from "../contracts";
import { taskListApplyResultSchema, taskListSchema } from "../contracts";

/**
 * Compact a PlanArtifact into a live working list.
 * Takes at most maxTasks flattened steps, all pending.
 * Does not execute or mark completion.
 */
export function deriveTaskListFromPlan(plan: PlanArtifact): TaskListApplyResult {
  const items: TaskItem[] = [];

  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      if (items.length >= TASK_LIST_POLICY.maxTasks) break;
      if (isProcessMetaStep(step.intent, step.actionSummary)) {
        continue;
      }
      const title = `${phase.name}: ${step.intent}`.slice(
        0,
        DEFAULT_MAX_TASK_TITLE_CHARS,
      );
      items.push({
        id: uniqueId(step.id || `task-${items.length + 1}`, items),
        title: title.trim() || `Step ${items.length + 1}`,
        status: "pending",
        ...(step.actionSummary
          ? {
              detail: step.actionSummary.slice(0, DEFAULT_MAX_TASK_DETAIL_CHARS),
            }
          : {}),
        sourceRef: step.id,
      });
    }
    if (items.length >= TASK_LIST_POLICY.maxTasks) break;
  }

  if (items.length === 0 && plan.objective.trim().length > 0) {
    items.push({
      id: "task-objective",
      title: plan.objective.slice(0, DEFAULT_MAX_TASK_TITLE_CHARS),
      status: "pending",
    });
  }

  if (items.length === 0) {
    return taskListApplyResultSchema.parse({
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      status: "rejected",
      warnings: ["Plan did not contain deriveable tasks."],
      reasonCodes: ["task_list_empty", "task_list_invalid"],
    });
  }

  const taskList = taskListSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: "plan",
    title: plan.objective.slice(0, DEFAULT_MAX_TASK_TITLE_CHARS),
    items,
  });

  return taskListApplyResultSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    status: "applied",
    taskList,
    warnings: [],
    reasonCodes: ["task_list_derived", "task_list_applied"],
  });
}

/**
 * Skill playbook / when-to-use bullets are not executable work items.
 */
function isProcessMetaStep(intent: string, actionSummary?: string): boolean {
  const text = `${intent} ${actionSummary ?? ""}`.trim();
  return TASK_LIST_POLICY.processMetaStep.test(text);
}

function uniqueId(raw: string, existing: readonly TaskItem[]): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "task";
  if (!existing.some((item) => item.id === base)) {
    return base;
  }
  let suffix = 2;
  while (existing.some((item) => item.id === `${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
