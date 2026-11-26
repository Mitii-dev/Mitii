/**
 * Steer: reorder TaskList so a preferred id runs next (S13.3).
 * No full rediscovery — only pending/active order changes.
 */

import type { TaskList } from "../../../modules/task-list";
import { softWarnTaskListLength } from "./SoftWarnTaskListLength";

export interface ReorderTaskListForSteerInput {
  taskList: TaskList;
  /** Task id the user wants next. */
  preferTaskId: string;
}

export interface ReorderTaskListForSteerResult {
  taskList: TaskList;
  reordered: boolean;
  reasonCodes: string[];
}

/**
 * Move preferTaskId to immediately after current active (or to front of pending).
 * Marks it active and demotes previous active to pending when needed.
 */
export function reorderTaskListForSteer(
  input: ReorderTaskListForSteerInput,
): ReorderTaskListForSteerResult {
  const items = input.taskList.items.map((i) => ({ ...i }));
  const preferIndex = items.findIndex((i) => i.id === input.preferTaskId);
  if (preferIndex < 0) {
    return {
      taskList: input.taskList,
      reordered: false,
      reasonCodes: ["task_steer_unknown_id"],
    };
  }

  const prefer = items[preferIndex]!;
  if (prefer.status === "done" || prefer.status === "skipped") {
    return {
      taskList: input.taskList,
      reordered: false,
      reasonCodes: ["task_steer_already_finished"],
    };
  }

  // Demote any other active to pending.
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]!.status === "active" && items[i]!.id !== prefer.id) {
      items[i] = { ...items[i]!, status: "pending" };
    }
  }
  items[preferIndex] = { ...prefer, status: "active" };

  // Stable: move preferred active to earliest unfinished slot.
  const [moved] = items.splice(preferIndex, 1);
  const insertAt = items.findIndex(
    (i) => i.status === "pending" || i.status === "active" || i.status === "blocked",
  );
  const at = insertAt < 0 ? items.length : insertAt;
  items.splice(at, 0, moved!);

  const nextList: TaskList = { ...input.taskList, items };
  const warn = softWarnTaskListLength(nextList);

  return {
    taskList: nextList,
    reordered: true,
    reasonCodes: ["task_steer_reordered", ...warn.reasonCodes],
  };
}
