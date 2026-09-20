import type { TaskList } from "../../../modules/task-list";

/**
 * Why the engine suspended with `continue_required`.
 * Host UI stays Continue/Stop; copy and resume resets vary by reason.
 */
export const BUDGET_WALL_REASONS = [
  "exploration_stall",
  "unfulfilled_execute",
  "rejected_mutation",
  "incomplete_execute",
  "budget_exhausted",
  "verification_repair_capped",
  "incomplete_checklist",
] as const;

export type BudgetWallReason = (typeof BUDGET_WALL_REASONS)[number];

function pendingChecklistTitles(taskList?: TaskList): string[] {
  if (!taskList) return [];
  return taskList.items
    .filter((item) => item.status !== "done" && item.status !== "skipped")
    .map((item) => item.title.trim())
    .filter((title) => title.length > 0);
}

function appendProgressLines(params: {
  lines: string[];
  changedFiles: readonly string[];
  taskList?: TaskList;
}): void {
  if (params.changedFiles.length > 0) {
    const preview = params.changedFiles.slice(0, 8).join(", ");
    const more =
      params.changedFiles.length > 8
        ? ` (+${params.changedFiles.length - 8} more)`
        : "";
    params.lines.push(
      `Completed so far: ${params.changedFiles.length} file(s) changed (${preview}${more}).`,
    );
  }

  const pending = pendingChecklistTitles(params.taskList);
  if (params.taskList) {
    const pendingCount = params.taskList.items.filter(
      (item) => item.status !== "done" && item.status !== "skipped",
    ).length;
    if (pendingCount > 0) {
      params.lines.push(
        `Still pending: ${pendingCount} checklist item(s)${pending.length > 0 ? ` — ${pending.slice(0, 5).join("; ")}` : ""}.`,
      );
    }
  }
}

/**
 * User-facing summary when a budget/stall wall asks Continue/Stop.
 */
export function buildBudgetWallRationale(params: {
  reason: BudgetWallReason;
  changedFiles: readonly string[];
  taskList?: TaskList;
  answer?: string;
  fileReadCalls?: number;
  uniqueFilePathsTouched?: number;
  mutationRequired?: boolean;
  budgetMessage?: string;
}): string {
  const zeroProgressMutation =
    params.mutationRequired === true && params.changedFiles.length === 0;
  const lines: string[] = [];

  switch (params.reason) {
    case "exploration_stall":
      lines.push(
        zeroProgressMutation
          ? "We've gathered enough context, but still need to land the first workspace edit."
          : "This task looks larger than expected, and we could use a little more time to finish it.",
      );
      break;
    case "unfulfilled_execute":
      lines.push(
        zeroProgressMutation
          ? "Ready to implement, but the first workspace edit has not landed yet."
          : "Edits are in progress, but the last turn stopped without applying the next patch.",
      );
      break;
    case "rejected_mutation":
      lines.push(
        "Our first edit attempts didn't land cleanly — we'd like to take another careful look before trying again.",
      );
      break;
    case "incomplete_execute":
      lines.push(
        "We made some progress, but we're not quite finished yet and could use a little more time.",
      );
      break;
    case "budget_exhausted":
      lines.push(
        params.budgetMessage?.trim() ||
          "The run stopped because Mitii call/loop budget was exhausted.",
      );
      break;
    case "verification_repair_capped":
      lines.push(
        "Verification repairs are capped and remaining errors are still open. Changes so far were kept.",
      );
      break;
    case "incomplete_checklist":
      lines.push(
        "The execute run ended while checklist change surfaces were still open.",
      );
      break;
  }

  appendProgressLines({
    lines,
    changedFiles: params.changedFiles,
    taskList: params.taskList,
  });

  if (
    params.reason === "exploration_stall" &&
    params.fileReadCalls !== undefined &&
    params.uniqueFilePathsTouched !== undefined
  ) {
    lines.push(
      `Exploration signal: ${params.fileReadCalls} file reads across ${params.uniqueFilePathsTouched} unique paths.`,
    );
  }

  if (
    zeroProgressMutation ||
    params.reason === "unfulfilled_execute" ||
    params.reason === "rejected_mutation" ||
    params.reason === "incomplete_execute"
  ) {
    lines.push(
      zeroProgressMutation || params.reason === "unfulfilled_execute"
        ? "Continue so we can apply the next workspace edit, share any files to focus on, or stop here."
        : "Mind if we dig a little deeper first? You can also share any tips (like files to focus on), or we can stop here.",
    );
  } else if (params.reason === "budget_exhausted") {
    lines.push(
      "Want us to keep going a bit longer, or stop here with what we have so far?",
    );
  } else if (params.reason === "verification_repair_capped") {
    lines.push(
      "Want us to take another pass at fixing the remaining issues, or stop here and keep the current changes?",
    );
  } else {
    lines.push("Want us to keep going, or stop here?");
  }

  return lines.join(" ");
}

/** @deprecated Prefer {@link buildBudgetWallRationale} with reason `exploration_stall`. */
export function buildStallContinueRationale(params: {
  changedFiles: readonly string[];
  taskList?: TaskList;
  answer?: string;
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
  mutationRequired?: boolean;
}): string {
  return buildBudgetWallRationale({
    reason: "exploration_stall",
    ...params,
  });
}

/**
 * Whether a budget/stall wall should suspend for a user Continue/Stop choice.
 * Returns false only when continue overrides are exhausted.
 */
export function shouldOfferBudgetWallContinue(params: {
  continueOverrideCount?: number;
  maxContinueOverrides?: number;
}): boolean {
  const maxOverrides = params.maxContinueOverrides ?? 2;
  return (params.continueOverrideCount ?? 0) < maxOverrides;
}

/** @deprecated Prefer {@link shouldOfferBudgetWallContinue}. */
export function shouldOfferStallContinue(params: {
  changedFiles: readonly string[];
  taskList?: TaskList;
  mutationRequired: boolean;
  continueOverrideCount?: number;
  maxContinueOverrides?: number;
}): boolean {
  return shouldOfferBudgetWallContinue(params);
}

/** Injected after the user approves Continue on a budget/stall wall. */
export function buildBudgetWallResetMessage(params: {
  reason: BudgetWallReason;
  guidance?: string;
  mutationRequired: boolean;
  changedFiles: readonly string[];
}): string {
  const parts: string[] = [];

  switch (params.reason) {
    case "exploration_stall":
      parts.push(
        "The user approved continuing after an exploration stall. Do not repeat the same re-read loop.",
      );
      break;
    case "unfulfilled_execute":
    case "rejected_mutation":
      parts.push(
        "The user approved continuing after a mutation recovery limit. Your next action MUST be apply_patch, delete_file, or move_file on a bounded surface. Do not call list_directory, glob_files, or search_files. If write/mustRead file contents are not yet in context, you may use up to five targeted read_file/read_many_files batches on those paths only, then patch immediately.",
      );
      break;
    case "incomplete_execute":
    case "incomplete_checklist":
      parts.push(
        "The user approved continuing after an incomplete execute stop. Finish remaining change surfaces or stop with a clear blocker.",
      );
      break;
    case "budget_exhausted":
      parts.push(
        "The user approved extending the run after budget exhaustion. Prefer a bounded next mutation or verification step.",
      );
      break;
    case "verification_repair_capped":
      parts.push(
        "The user approved another verification repair pass. Fix remaining errors with bounded patches; do not restart broad exploration.",
      );
      break;
  }

  if (
    params.mutationRequired &&
    params.changedFiles.length === 0 &&
    params.reason !== "verification_repair_capped" &&
    params.reason !== "budget_exhausted"
  ) {
    parts.push(
      "Call apply_patch/delete_file/move_file now, or stop with a clear blocker. Analysis-only turns are not allowed.",
    );
  } else if (
    params.reason === "exploration_stall" ||
    params.reason === "incomplete_checklist"
  ) {
    parts.push(
      "Change strategy: target remaining checklist writes, or finish with a concrete answer.",
    );
  }

  const guidance = params.guidance?.trim();
  if (guidance) {
    parts.push(`User guidance: ${guidance}`);
  }
  return parts.join(" ");
}

/** @deprecated Prefer {@link buildBudgetWallResetMessage}. */
export function buildStallContinueResetMessage(params: {
  guidance?: string;
  mutationRequired: boolean;
  changedFiles: readonly string[];
}): string {
  return buildBudgetWallResetMessage({
    reason: "exploration_stall",
    ...params,
  });
}
