/**
 * Soft warn when TaskList length > 8 (S13.4) — still allow.
 */

import type { TaskList } from "../../../modules/task-list";

export const TASK_LIST_SOFT_WARN_LENGTH = 8;

export function softWarnTaskListLength(taskList: TaskList): {
  warned: boolean;
  reasonCodes: string[];
} {
  if (taskList.items.length > TASK_LIST_SOFT_WARN_LENGTH) {
    return {
      warned: true,
      reasonCodes: ["task_list_length_soft_warn"],
    };
  }
  return { warned: false, reasonCodes: [] };
}
