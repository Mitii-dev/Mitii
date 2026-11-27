/**
 * On failed verification, seal a curated 2-slice repair desk:
 * Fix (active) → Re-verify (pending). Titles come from the failure record only.
 */

import {
  DEFAULT_MAX_TASK_DETAIL_CHARS,
  DEFAULT_MAX_TASK_PATHS,
  DEFAULT_MAX_TASK_TITLE_CHARS,
  TASK_LIST_SCHEMA_VERSION,
  taskListSchema,
  type TaskList,
} from "../../../modules/task-list";
import type { AgentVerifyEvidence } from "./SummarizeAgentVerifyEvidence";

export const VERIFY_REPAIR_DESK_TITLE = "Verification repair";
export const REPAIR_FIX_ID = "repair_fix";
export const REPAIR_REVERIFY_ID = "repair_reverify";

export function isVerifyRepairDesk(taskList: TaskList | undefined): boolean {
  if (!taskList?.items?.length) return false;
  if (taskList.title === VERIFY_REPAIR_DESK_TITLE) return true;
  const ids = new Set(taskList.items.map((item) => item.id));
  return ids.has(REPAIR_FIX_ID) && ids.has(REPAIR_REVERIFY_ID);
}

export function isRunnerVerifyFailed(
  runnerStatus: string | undefined,
): boolean {
  return (
    runnerStatus === "failed" ||
    runnerStatus === "repair_requested" ||
    runnerStatus === "repair_capped" ||
    runnerStatus === "blocked"
  );
}

export function shouldSealVerifyRepairDesk(input: {
  agentEvidence?: AgentVerifyEvidence;
  runnerStatus?: string;
}): boolean {
  if (input.agentEvidence?.outcome === "failed") return true;
  return isRunnerVerifyFailed(input.runnerStatus);
}

export function sealVerifyRepairDesk(input: {
  failureNote: string;
  failedCommand?: string;
  checksRun?: readonly string[];
  changedFiles?: readonly string[];
  hint?: string;
}): TaskList {
  const command = input.failedCommand?.trim() ?? "";
  const shortCmd =
    command.length > 80 ? `${command.slice(0, 77)}...` : command;
  const fixTitle = shortCmd
    ? `Address verification failures: ${shortCmd}`
    : "Address verification failures";
  const fixDetailParts = [
    input.failureNote.trim(),
    input.hint?.trim() ? `Hint: ${input.hint.trim()}` : "",
  ].filter((part) => part.length > 0);
  const reverifyDetail = shortCmd
    ? `Re-run: ${shortCmd}`
    : input.checksRun && input.checksRun.length > 0
      ? `Re-run checks: ${input.checksRun.slice(0, 4).join(", ")}`
      : "Re-run the same verification checks for this change set";
  const write = (input.changedFiles ?? [])
    .map((path) => path.replace(/\\/g, "/").trim())
    .filter((path) => path.length > 0)
    .slice(0, DEFAULT_MAX_TASK_PATHS);

  return taskListSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: "agent",
    purpose: "execution",
    title: VERIFY_REPAIR_DESK_TITLE,
    items: [
      {
        id: REPAIR_FIX_ID,
        title: clip(fixTitle, DEFAULT_MAX_TASK_TITLE_CHARS),
        status: "active",
        detail: clip(
          fixDetailParts.join(" — ") || "Fix the failing verification evidence",
          DEFAULT_MAX_TASK_DETAIL_CHARS,
        ),
        ...(write.length > 0 ? { write } : {}),
      },
      {
        id: REPAIR_REVERIFY_ID,
        title: "Re-run verification for this change set",
        status: "pending",
        detail: clip(reverifyDetail, DEFAULT_MAX_TASK_DETAIL_CHARS),
      },
    ],
  });
}

/** After a green re-verify, restore the prior campaign desk when present. */
export function clearOrRestoreAfterVerifyPass(input: {
  current?: TaskList;
  prior?: TaskList;
}): { taskList?: TaskList; restored: boolean; reasonCodes: string[] } {
  if (!isVerifyRepairDesk(input.current)) {
    return { taskList: input.current, restored: false, reasonCodes: [] };
  }
  if (input.prior && !isVerifyRepairDesk(input.prior)) {
    return {
      taskList: input.prior,
      restored: true,
      reasonCodes: ["tasklist_restored_after_verify_pass"],
    };
  }
  const cleared = taskListSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: "agent",
    purpose: "execution",
    title: VERIFY_REPAIR_DESK_TITLE,
    items: (input.current?.items ?? []).map((item) => ({
      ...item,
      status: "done" as const,
    })),
  });
  return {
    taskList: cleared,
    restored: false,
    reasonCodes: ["tasklist_repair_cleared_after_verify_pass"],
  };
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
}
