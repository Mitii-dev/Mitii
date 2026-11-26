/**
 * TaskList → Briefcase workingMaterials text (S11-TASK / S11-BRIEF).
 * Module owns serialize; runtime only invokes.
 */

import {
  serializeTaskListForPrompt,
  serializeWorkingSetForLoop,
  type TaskList,
} from "../../../modules/task-list";

export interface FormatTaskListForBriefcaseResult {
  /** Full prompt block (instruction trust). */
  promptBlock?: string;
  /** Compact open-items reinject for volatile suffix. */
  workingSet?: string;
  reasonCodes: string[];
}

export function formatTaskListForBriefcase(
  taskList: TaskList | undefined,
): FormatTaskListForBriefcaseResult {
  if (!taskList || taskList.items.length === 0) {
    return { reasonCodes: ["briefcase_task_list_empty"] };
  }
  const promptBlock = serializeTaskListForPrompt(taskList);
  const workingSet = serializeWorkingSetForLoop(taskList);
  return {
    promptBlock,
    ...(workingSet ? { workingSet } : {}),
    reasonCodes: ["briefcase_task_list_attached"],
  };
}
