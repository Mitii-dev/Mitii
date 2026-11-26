/**
 * Persist TaskList + handoffs after mutate settle (S11-TASK).
 */

import type { TaskList } from "../../../modules/task-list";
import type { TaskHandoffNote } from "../../contracts/handoff/TaskHandoffNote";
import { extractChangedPathsFromToolArgs } from "./ExtractChangedPathsFromToolArgs";
import { updateTaskListOnSettle } from "./UpdateTaskListOnSettle";

export function applyTaskSettleToStore(input: {
  store: {
    getSlice: <T>(key: string) => T | undefined;
    setSlice: (key: string, value: unknown) => void;
  };
  args: unknown;
  effect: "none" | "read" | "mutate" | "external";
  status: "succeeded" | "failed";
}): string[] {
  if (input.effect !== "mutate" || input.status !== "succeeded") {
    return [];
  }
  const taskList = input.store.getSlice<TaskList>("taskList");
  if (!taskList) return [];

  const changedPaths = extractChangedPathsFromToolArgs(input.args);
  const handoffs = input.store.getSlice<TaskHandoffNote[]>("taskHandoffs");
  const result = updateTaskListOnSettle({
    taskList,
    handoffs,
    changedPaths,
  });
  input.store.setSlice("taskList", result.taskList);
  if (result.advanced) {
    input.store.setSlice("taskHandoffs", result.handoffs);
  }
  return result.reasonCodes;
}
