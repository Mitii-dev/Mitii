import type { PlanArtifact } from "../../planning";

import { TASK_LIST_SCHEMA_VERSION } from "../constants";
import { resolveMaxTasks } from "../policy";
import type { TaskItem, TaskList, TaskListApplyResult } from "../contracts";
import { taskListApplyResultSchema, taskListSchema } from "../contracts";
import { isTerminalTaskStatus } from "./ApplyTaskListUpdate";
import {
  buildTaskItem,
  collectConcretePlanStepCandidates,
} from "./DeriveTaskListFromPlan";

/**
 * Stream unused plan steps onto the live list after earlier items complete.
 * Drops oldest done/skipped rows only when the list is at maxTasks and
 * overflow remains. Never re-adds step ids from `completedStepIds` (engine
 * notebook). Does not invent work for agent-replaced checklists.
 */
export function refillTaskListFromPlan(params: {
  current: TaskList;
  plan: PlanArtifact;
  maxTasks?: number;
  /** Durable finished plan step ids — never returned to the desk. */
  completedStepIds?: readonly string[];
}): TaskListApplyResult {
  const liveMaxTasks = resolveMaxTasks(params.maxTasks);
  if (params.current.purpose === "discovery") {
    return unchanged(params.current);
  }

  const candidates = collectConcretePlanStepCandidates(params.plan);
  if (candidates.length === 0) {
    return unchanged(params.current);
  }

  const planStepIds = new Set(candidates.map((candidate) => candidate.step.id));
  const stillPlanDerived = params.current.items.some(
    (item) => item.sourceRef !== undefined && planStepIds.has(item.sourceRef),
  );
  if (!stillPlanDerived) {
    return unchanged(params.current);
  }

  const completed = new Set(
    (params.completedStepIds ?? []).filter((id) => id.length > 0),
  );
  const occupied = new Set(
    params.current.items
      .map((item) => item.sourceRef ?? item.id)
      .filter((id) => id.length > 0),
  );
  const unused = candidates.filter(
    (candidate) =>
      !occupied.has(candidate.step.id) && !completed.has(candidate.step.id),
  );
  if (unused.length === 0) {
    return unchanged(params.current);
  }

  const items = params.current.items.map((item) => ({ ...item }));
  let nextUnused = 0;
  while (nextUnused < unused.length) {
    if (items.length < liveMaxTasks) {
      items.push(
        buildIncomingItem(unused[nextUnused]!, items),
      );
      nextUnused += 1;
      continue;
    }
    const dropIndex = items.findIndex((item) =>
      isTerminalTaskStatus(item.status),
    );
    if (dropIndex < 0) {
      break;
    }
    items.splice(dropIndex, 1);
  }

  if (nextUnused === 0 && sameIds(params.current.items, items)) {
    return unchanged(params.current);
  }

  if (!items.some((item) => item.status === "active")) {
    const nextPending = items.find((item) => item.status === "pending");
    if (nextPending) {
      nextPending.status = "active";
    }
  }

  const taskList = taskListSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: params.current.source,
    purpose: params.current.purpose ?? "execution",
    title: params.current.title,
    items,
  });

  return taskListApplyResultSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    status: "applied",
    taskList,
    warnings: [],
    reasonCodes: ["task_list_refilled", "task_list_applied"],
  });
}

function buildIncomingItem(
  candidate: ReturnType<typeof collectConcretePlanStepCandidates>[number],
  existing: readonly TaskItem[],
): TaskItem {
  return {
    ...buildTaskItem({
      phaseName: candidate.phase.name,
      step: candidate.step,
      index: existing.length,
      existing,
    }),
    status: "pending",
  };
}

function sameIds(left: readonly TaskItem[], right: readonly TaskItem[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item.id === right[index]?.id);
}

function unchanged(current: TaskList): TaskListApplyResult {
  return taskListApplyResultSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    status: "applied",
    taskList: current,
    warnings: [],
    reasonCodes: ["task_list_unchanged"],
  });
}
