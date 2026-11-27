/**
 * End-of-turn campaign progress when the active checklist row has no bound
 * write targets (seeded / agent desk lists). One mutating turn → one slice.
 */

import type { TaskList } from "../../../modules/task-list";
import type { TaskHandoffNote } from "../../contracts/handoff/TaskHandoffNote";
import { advanceTaskWithHandoff } from "../handoff/AdvanceTaskWithHandoff";
import { appendTaskHandoff } from "../handoff/AppendTaskHandoff";
import { itemWriteTargetsMatchChangedFiles } from "../../../modules/task-list";

export function finalizeCampaignSliceOnFinish(input: {
  store: {
    getSlice: <T>(key: string) => T | undefined;
    setSlice: (key: string, value: unknown) => void;
  };
  editsLanded: boolean;
}): { advanced: boolean; advancedIds: string[]; reasonCodes: string[] } {
  if (!input.editsLanded) {
    return { advanced: false, advancedIds: [], reasonCodes: [] };
  }
  const taskList = input.store.getSlice<TaskList>("taskList");
  if (!taskList?.items?.length) {
    return {
      advanced: false,
      advancedIds: [],
      reasonCodes: ["campaign_finalize_no_tasklist"],
    };
  }
  if (
    taskList.purpose === "discovery" ||
    taskList.source === "discovery"
  ) {
    return {
      advanced: false,
      advancedIds: [],
      reasonCodes: ["campaign_finalize_discovery"],
    };
  }

  const active = taskList.items.find((item) => item.status === "active");
  if (!active) {
    return {
      advanced: false,
      advancedIds: [],
      reasonCodes: ["campaign_finalize_no_active"],
    };
  }
  // Bound rows are advanced mid-loop via path match; do not double-complete.
  if (active.write && active.write.length > 0) {
    return {
      advanced: false,
      advancedIds: [],
      reasonCodes: ["campaign_finalize_bound_active"],
    };
  }

  const changed =
    input.store.getSlice<string[]>("changedFiles") ??
    input.store.getSlice<string[]>("mutatedPaths") ??
    [];
  // If title/detail already encode package roots and matched mid-loop, skip.
  if (
    changed.length > 0 &&
    itemWriteTargetsMatchChangedFiles(active, changed)
  ) {
    return {
      advanced: false,
      advancedIds: [],
      reasonCodes: ["campaign_finalize_already_matched"],
    };
  }

  const advanced = advanceTaskWithHandoff({
    taskList,
    action: "complete",
    doneSummary:
      changed.length > 0
        ? `Slice landed: ${changed.slice(0, 4).join(", ")}`
        : "Slice landed this turn",
    artifactsWritten: changed.slice(0, 16),
  });
  input.store.setSlice("taskList", advanced.taskList);
  const handoffs = input.store.getSlice<TaskHandoffNote[]>("taskHandoffs");
  input.store.setSlice(
    "taskHandoffs",
    appendTaskHandoff(handoffs, advanced.note),
  );
  const completed =
    input.store.getSlice<string[]>("completedPlanStepIds") ?? [];
  const newlyDone = advanced.taskList.items
    .filter((item) => item.status === "done")
    .map((item) => item.sourceRef?.trim() || item.id)
    .filter(Boolean);
  input.store.setSlice("completedPlanStepIds", [
    ...new Set([...completed, ...newlyDone]),
  ]);
  const advancedIds = [active.id];
  input.store.setSlice("campaignAdvancedThisTurn", advancedIds);
  return {
    advanced: true,
    advancedIds,
    reasonCodes: ["campaign_finalize_unbound_advanced", ...advanced.reasonCodes],
  };
}
