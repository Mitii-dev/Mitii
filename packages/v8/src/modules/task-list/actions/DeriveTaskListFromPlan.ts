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
 * Prefers executable work phases, then falls back to discovery-only steps.
 * Does not execute or mark completion.
 */
export function deriveTaskListFromPlan(plan: PlanArtifact): TaskListApplyResult {
  const preferred: PlanStepCandidate[] = [];
  const deferred: PlanStepCandidate[] = [];

  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      if (isProcessMetaStep(step.intent, step.actionSummary)) {
        continue;
      }
      if (isPreferredStep(phase.name, step.intent)) {
        preferred.push({ phase, step });
      } else {
        deferred.push({ phase, step });
      }
    }
  }

  const selected = [...preferred, ...deferred].slice(0, TASK_LIST_POLICY.maxTasks);
  const items: TaskItem[] = [];
  for (const { phase, step } of selected) {
    items.push(
      buildTaskItem({
        phaseName: phase.name,
        step,
        index: items.length,
        existing: items,
      }),
    );
  }

  if (items.length === 0 && plan.objective.trim().length > 0) {
    items.push({
      id: "task-objective",
      title: plan.objective.slice(0, DEFAULT_MAX_TASK_TITLE_CHARS),
      // Single fallback item starts active for Agent auto-advance.
      status: "active",
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

type PlanStepCandidate = {
  phase: PlanArtifact["phases"][number];
  step: PlanArtifact["phases"][number]["steps"][number];
};

function isPreferredStep(phaseName: string, intent: string): boolean {
  if (TASK_LIST_POLICY.preferredPhaseNames.test(phaseName.trim())) {
    return true;
  }
  return (
    !TASK_LIST_POLICY.deferredPhaseNames.test(phaseName.trim()) &&
    !TASK_LIST_POLICY.deferredIntent.test(intent.trim())
  );
}

function buildTaskItem(params: {
  phaseName: string;
  step: PlanArtifact["phases"][number]["steps"][number];
  index: number;
  existing: readonly TaskItem[];
}): TaskItem {
  const title = `${params.phaseName}: ${params.step.intent}`.slice(
    0,
    DEFAULT_MAX_TASK_TITLE_CHARS,
  );
  const detailParts = [
    params.step.targetRefs[0] ? `Scope: ${params.step.targetRefs[0]}` : undefined,
    params.step.actionSummary,
  ].filter(Boolean);
  return {
    id: uniqueId(params.step.id || `task-${params.index + 1}`, params.existing),
    title: title.trim() || `Step ${params.index + 1}`,
    // First derived item starts active so mutating tools can auto-advance.
    status: params.index === 0 ? "active" : "pending",
    ...(detailParts.length > 0
      ? {
          detail: detailParts
            .join(" - ")
            .slice(0, DEFAULT_MAX_TASK_DETAIL_CHARS),
        }
      : {}),
    sourceRef: params.step.id,
  };
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
