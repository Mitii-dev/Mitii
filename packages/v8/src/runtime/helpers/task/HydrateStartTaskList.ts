/**
 * Load host-carried campaign checklist into the store before decide/plan.
 */

import type { TaskList } from "../../../modules/task-list";
import type { RuntimeStartInput } from "../../contracts/input/RuntimeStartInput";

function isExecutionChecklist(list: TaskList | undefined): boolean {
  if (!list?.items?.length) return false;
  if (list.purpose === "discovery" || list.source === "discovery") {
    return false;
  }
  return true;
}

/** True when the checklist still has work the host can Continue into. */
export function hasOpenExecutionChecklist(
  list: TaskList | undefined,
): boolean {
  if (!isExecutionChecklist(list)) return false;
  return list!.items.some(
    (item) => item.status === "pending" || item.status === "active",
  );
}

/**
 * Prefer host taskList over empty store; never clobber a richer live list.
 */
export function hydrateStartTaskList(input: {
  store: {
    getSlice: <T>(key: string) => T | undefined;
    setSlice: (key: string, value: unknown) => void;
  };
  start: RuntimeStartInput;
}): { hydrated: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  // Fresh run: this-turn advance stamp must not leak across turns.
  input.store.setSlice("campaignAdvancedThisTurn", []);

  const incoming = input.start.taskList;
  if (isExecutionChecklist(incoming)) {
    const current = input.store.getSlice<TaskList>("taskList");
    if (!isExecutionChecklist(current)) {
      input.store.setSlice("taskList", incoming);
      reasonCodes.push("tasklist_hydrated_from_start");
    }
  }

  const completed = input.start.completedPlanStepIds;
  if (completed && completed.length > 0) {
    const prior =
      input.store.getSlice<string[]>("completedPlanStepIds") ?? [];
    input.store.setSlice("completedPlanStepIds", [
      ...new Set([...prior, ...completed.filter((id) => id.trim().length > 0)]),
    ]);
    reasonCodes.push("completed_steps_hydrated_from_start");
  }

  return { hydrated: reasonCodes.length > 0, reasonCodes };
}
