/**
 * Complete or skip the active task, write handoff, activate next (S13).
 */

import type { TaskHandoffNote } from "../../contracts/handoff/TaskHandoffNote";
import type { TaskItem, TaskList } from "../../../modules/task-list";
import { buildTaskHandoffNote } from "./BuildTaskHandoffNote";
import { softWarnTaskListLength } from "./SoftWarnTaskListLength";

export type AdvanceTaskAction = "complete" | "skip";

export interface AdvanceTaskWithHandoffInput {
  taskList: TaskList;
  action: AdvanceTaskAction;
  doneSummary: string;
  artifactsWritten?: readonly string[];
  evidenceRefs?: readonly string[];
  nextMustRead?: readonly string[];
  assumptions?: readonly string[];
  impactSiteIds?: readonly string[];
  /** Extra blockers (skip always adds user_skipped). */
  blockersRemaining?: readonly string[];
}

export interface AdvanceTaskWithHandoffResult {
  taskList: TaskList;
  note: TaskHandoffNote;
  reasonCodes: string[];
}

/**
 * Marks active (or first pending) task done/skipped, activates next pending.
 */
export function advanceTaskWithHandoff(
  input: AdvanceTaskWithHandoffInput,
): AdvanceTaskWithHandoffResult {
  const items = input.taskList.items.map((item) => ({ ...item }));
  const activeIndex = items.findIndex((i) => i.status === "active");
  const fromIndex =
    activeIndex >= 0
      ? activeIndex
      : items.findIndex((i) => i.status === "pending");

  if (fromIndex < 0) {
    const emptyNote = buildTaskHandoffNote({
      fromTaskId: "none",
      doneSummary: input.doneSummary || "No active task to advance.",
      blockersRemaining: ["no_active_task"],
    });
    return {
      taskList: input.taskList,
      note: emptyNote,
      reasonCodes: ["task_handoff_no_active"],
    };
  }

  const from = items[fromIndex]!;
  const nextPending = items.find(
    (item, idx) => idx > fromIndex && item.status === "pending",
  );

  const status: TaskItem["status"] =
    input.action === "skip" ? "skipped" : "done";
  items[fromIndex] = { ...from, status };

  if (nextPending) {
    const nextIndex = items.findIndex((i) => i.id === nextPending.id);
    items[nextIndex] = { ...items[nextIndex]!, status: "active" };
  }

  const blockers = [
    ...(input.action === "skip" ? ["user_skipped"] : []),
    ...(input.blockersRemaining ?? []),
  ];

  const note = buildTaskHandoffNote({
    fromTaskId: from.id,
    toTaskId: nextPending?.id,
    doneSummary: input.doneSummary,
    artifactsWritten: input.artifactsWritten,
    evidenceRefs: input.evidenceRefs,
    blockersRemaining: blockers,
    nextMustRead:
      input.nextMustRead ?? nextPending?.mustRead ?? nextPending?.write,
    assumptions: input.assumptions,
    impactSiteIds: input.impactSiteIds,
  });

  const nextList: TaskList = {
    ...input.taskList,
    items,
  };

  const warn = softWarnTaskListLength(nextList);

  return {
    taskList: nextList,
    note,
    reasonCodes: [
      input.action === "skip" ? "task_handoff_skipped" : "task_handoff_completed",
      ...(nextPending ? ["task_handoff_advanced"] : ["task_handoff_list_exhausted"]),
      ...warn.reasonCodes,
    ],
  };
}
