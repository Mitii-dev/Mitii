/**
 * On failed verification, seal a curated 2-slice repair desk:
 * Fix (active) → Re-verify (pending). Titles come from the failure record only.
 * Re-fails update in place (no treadmill reset). Green verify clears the desk.
 */

import {
  DEFAULT_MAX_TASK_DETAIL_CHARS,
  DEFAULT_MAX_TASK_PATHS,
  DEFAULT_MAX_TASK_TITLE_CHARS,
  TASK_LIST_SCHEMA_VERSION,
  taskListSchema,
  type TaskList,
} from "../../../modules/task-list";
import { isInternalHostPath } from "../orient/IsInternalHostPath";
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

/** Finish-phase codes that mean env/infra, not a product defect to Fix→Re-verify. */
const INFRA_RUNNER_REASON_CODES = new Set([
  "verification_unavailable",
  "checks_unavailable",
  "no_applicable_checks",
  "missing_tool_degraded",
  "state_unavailable",
  "grant_insufficient",
]);

export function isInfraVerifyNoise(input: {
  runnerStatus?: string;
  runnerReasonCodes?: readonly string[];
}): boolean {
  if (input.runnerStatus === "unavailable") return true;
  return (input.runnerReasonCodes ?? []).some((code) =>
    INFRA_RUNNER_REASON_CODES.has(code),
  );
}

/**
 * Soft pass for desk ownership: selective tests green, or the environment
 * could not actually prove a product failure (sandbox/EPERM/unavailable).
 * Used to restore the prior campaign instead of trapping Continue on repair.
 */
export function isVerifyDeskSoftPass(input: {
  agentEvidence?: AgentVerifyEvidence;
  runnerStatus?: string;
  runnerReasonCodes?: readonly string[];
}): boolean {
  const outcome = input.agentEvidence?.outcome;
  if (outcome === "passed" || outcome === "could_not_run") return true;
  if (input.runnerStatus === "passed") return true;
  if (isInfraVerifyNoise(input)) return true;
  return false;
}

export function shouldSealVerifyRepairDesk(input: {
  agentEvidence?: AgentVerifyEvidence;
  runnerStatus?: string;
  runnerReasonCodes?: readonly string[];
}): boolean {
  // Agent selective tests are authoritative — a green node --test must not be
  // overwritten by a hollow finish-phase runner fail (that caused the Continue
  // treadmill after http-desugar already passed).
  if (input.agentEvidence?.outcome === "passed") return false;
  // Sandbox / env could not run the selective command — not a repair desk.
  if (input.agentEvidence?.outcome === "could_not_run") return false;
  // Unknown exit is inconclusive — do not seal a Fix→Re-verify treadmill.
  if (input.agentEvidence?.outcome === "ran_unknown") return false;
  if (input.agentEvidence?.outcome === "failed") return true;
  // Infra/unavailable (even when remapped to failed) is not product repair.
  if (isInfraVerifyNoise(input)) return false;
  return isRunnerVerifyFailed(input.runnerStatus);
}

export function sealVerifyRepairDesk(input: {
  failureNote: string;
  failedCommand?: string;
  checksRun?: readonly string[];
  changedFiles?: readonly string[];
  hint?: string;
}): TaskList {
  const titles = repairTitles(input);
  const write = filterProductWrites(input.changedFiles);

  return taskListSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: "agent",
    purpose: "execution",
    title: VERIFY_REPAIR_DESK_TITLE,
    items: [
      {
        id: REPAIR_FIX_ID,
        title: titles.fixTitle,
        status: "active",
        detail: titles.fixDetail,
        ...(write.length > 0 ? { write } : {}),
      },
      {
        id: REPAIR_REVERIFY_ID,
        title: "Re-run verification for this change set",
        status: "pending",
        detail: titles.reverifyDetail,
      },
    ],
  });
}

/**
 * Already on the repair desk + verify failed again: update evidence in place.
 * If this turn landed edits, advance Fix → done and activate Re-verify so
 * Continue is not the same "Address verification failures" forever.
 */
export function updateVerifyRepairDeskOnFail(input: {
  current: TaskList;
  failureNote: string;
  failedCommand?: string;
  checksRun?: readonly string[];
  changedFiles?: readonly string[];
  hint?: string;
  editsLanded?: boolean;
}): TaskList {
  const titles = repairTitles(input);
  const write = filterProductWrites(input.changedFiles);
  const priorFix = input.current.items.find((item) => item.id === REPAIR_FIX_ID);
  const priorReverify = input.current.items.find(
    (item) => item.id === REPAIR_REVERIFY_ID,
  );
  const fixAlreadyDone = priorFix?.status === "done";
  const advanceFix = Boolean(input.editsLanded) || fixAlreadyDone;

  const mergedWrite = [
    ...new Set([...(priorFix?.write ?? []), ...write]),
  ].slice(0, DEFAULT_MAX_TASK_PATHS);

  return taskListSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: "agent",
    purpose: "execution",
    title: VERIFY_REPAIR_DESK_TITLE,
    items: [
      {
        id: REPAIR_FIX_ID,
        title: advanceFix
          ? priorFix?.title ?? titles.fixTitle
          : titles.fixTitle,
        status: advanceFix ? "done" : "active",
        detail: advanceFix
          ? priorFix?.detail ?? titles.fixDetail
          : titles.fixDetail,
        ...(mergedWrite.length > 0 ? { write: mergedWrite } : {}),
      },
      {
        id: REPAIR_REVERIFY_ID,
        title: "Re-run verification for this change set",
        status: advanceFix ? "active" : (priorReverify?.status ?? "pending"),
        detail: titles.reverifyDetail,
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
  // No prior campaign — clear the repair desk entirely so Continue dies.
  return {
    taskList: taskListSchema.parse({
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "agent",
      purpose: "execution",
      title: VERIFY_REPAIR_DESK_TITLE,
      items: [],
    }),
    restored: false,
    reasonCodes: ["tasklist_repair_cleared_after_verify_pass"],
  };
}

function repairTitles(input: {
  failureNote: string;
  failedCommand?: string;
  checksRun?: readonly string[];
  hint?: string;
}): { fixTitle: string; fixDetail: string; reverifyDetail: string } {
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
  return {
    fixTitle: clip(fixTitle, DEFAULT_MAX_TASK_TITLE_CHARS),
    fixDetail: clip(
      fixDetailParts.join(" — ") || "Fix the failing verification evidence",
      DEFAULT_MAX_TASK_DETAIL_CHARS,
    ),
    reverifyDetail: clip(reverifyDetail, DEFAULT_MAX_TASK_DETAIL_CHARS),
  };
}

function filterProductWrites(
  changedFiles: readonly string[] | undefined,
): string[] {
  return (changedFiles ?? [])
    .map((path) => path.replace(/\\/g, "/").trim())
    .filter((path) => path.length > 0 && !isInternalHostPath(path))
    .slice(0, DEFAULT_MAX_TASK_PATHS);
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
}
