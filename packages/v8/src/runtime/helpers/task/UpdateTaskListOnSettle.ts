/**
 * After a mutating tool settles, advance TaskList when write paths match (S11-TASK).
 * Prefer explicit write/mustRead/affected; never invent completion without path match.
 */

import {
  itemWriteTargetsMatchChangedFiles,
  type TaskList,
} from "../../../modules/task-list";
import type { TaskHandoffNote } from "../../contracts/handoff/TaskHandoffNote";
import { advanceTaskWithHandoff } from "../handoff/AdvanceTaskWithHandoff";
import { appendTaskHandoff } from "../handoff/AppendTaskHandoff";

export interface UpdateTaskListOnSettleInput {
  taskList: TaskList;
  handoffs?: readonly TaskHandoffNote[];
  /** Paths mutated by the settled tool batch. */
  changedPaths: readonly string[];
  /** When true, complete active task if paths match (default true). */
  completeOnMatch?: boolean;
  doneSummary?: string;
}

export interface UpdateTaskListOnSettleResult {
  taskList: TaskList;
  handoffs: TaskHandoffNote[];
  advanced: boolean;
  reasonCodes: string[];
}

export function updateTaskListOnSettle(
  input: UpdateTaskListOnSettleInput,
): UpdateTaskListOnSettleResult {
  const changed = [
    ...new Set(input.changedPaths.map((p) => p.trim()).filter(Boolean)),
  ];
  if (changed.length === 0) {
    return {
      taskList: input.taskList,
      handoffs: [...(input.handoffs ?? [])],
      advanced: false,
      reasonCodes: ["task_settle_no_paths"],
    };
  }

  const active = input.taskList.items.find((i) => i.status === "active");
  if (!active) {
    return {
      taskList: input.taskList,
      handoffs: [...(input.handoffs ?? [])],
      advanced: false,
      reasonCodes: ["task_settle_no_active"],
    };
  }

  const matches = itemWriteTargetsMatchChangedFiles(active, changed);
  if (!matches) {
    return {
      taskList: input.taskList,
      handoffs: [...(input.handoffs ?? [])],
      advanced: false,
      reasonCodes: ["task_settle_no_path_match"],
    };
  }

  if (input.completeOnMatch === false) {
    return {
      taskList: input.taskList,
      handoffs: [...(input.handoffs ?? [])],
      advanced: false,
      reasonCodes: ["task_settle_match_held"],
    };
  }

  const advanced = advanceTaskWithHandoff({
    taskList: input.taskList,
    action: "complete",
    doneSummary:
      input.doneSummary ??
      `Settled writes: ${changed.slice(0, 4).join(", ")}`,
    artifactsWritten: changed.slice(0, 16),
  });

  return {
    taskList: advanced.taskList,
    handoffs: appendTaskHandoff(input.handoffs, advanced.note),
    advanced: true,
    reasonCodes: ["task_settle_advanced", ...advanced.reasonCodes],
  };
}
