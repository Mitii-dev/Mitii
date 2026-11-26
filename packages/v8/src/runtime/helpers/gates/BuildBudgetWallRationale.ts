/**
 * User-facing summary when continue_required asks Continue/Stop (§10.3).
 * Accepts trimmed ContinueReason or legacy BudgetWallReason (shimmed).
 */

import type { TaskList } from "../../../modules/task-list";
import type { ContinueReason } from "./constants";
import { mapLegacyContinueReason } from "./MapLegacyContinueReason";

export interface BuildBudgetWallRationaleInput {
  reason: ContinueReason | string;
  changedFiles: readonly string[];
  taskList?: TaskList;
  answer?: string;
  fileReadCalls?: number;
  uniqueFilePathsTouched?: number;
  mutationRequired?: boolean;
  budgetMessage?: string;
}

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
        `Still pending: ${pendingCount} checklist item(s)${
          pending.length > 0 ? ` — ${pending.slice(0, 5).join("; ")}` : ""
        }.`,
      );
    }
  }
}

export function buildBudgetWallRationale(
  params: BuildBudgetWallRationaleInput,
): string {
  const reason = mapLegacyContinueReason(params.reason);
  const zeroProgressMutation =
    params.mutationRequired === true && params.changedFiles.length === 0;
  const lines: string[] = [];

  switch (reason) {
    case "stalled_or_blocked":
      lines.push(
        zeroProgressMutation
          ? "We've gathered enough context, but still need to land the first workspace edit."
          : "This task looks larger than expected, and we could use a little more time to finish it.",
      );
      break;
    case "incomplete_progress":
      lines.push(
        zeroProgressMutation
          ? "Ready to implement, but the first workspace edit has not landed yet."
          : "We made some progress, but we're not quite finished yet and could use a little more time.",
      );
      break;
    case "evidence_clarify":
      lines.push(
        "I don't have a concrete file path to edit yet after the evidence budget was used.",
      );
      break;
    case "provider_unavailable":
      lines.push(
        "The model provider is unreachable (network/infrastructure) after bounded retries.",
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
  }

  appendProgressLines({
    lines,
    changedFiles: params.changedFiles,
    taskList: params.taskList,
  });

  if (
    reason === "stalled_or_blocked" &&
    params.fileReadCalls !== undefined &&
    params.uniqueFilePathsTouched !== undefined
  ) {
    lines.push(
      `Exploration signal: ${params.fileReadCalls} file reads across ${params.uniqueFilePathsTouched} unique paths.`,
    );
  }

  if (reason === "evidence_clarify") {
    lines.push(
      "Continue with an explicit file path to focus on, or stop here. Do not expect another open-ended search pass.",
    );
  } else if (reason === "provider_unavailable") {
    lines.push(
      "Continue to retry the provider when the network is back, or stop here. Progress so far is preserved.",
    );
  } else if (zeroProgressMutation || reason === "incomplete_progress") {
    lines.push(
      zeroProgressMutation
        ? "Continue so we can apply the next workspace edit, share any files to focus on, or stop here."
        : "Mind if we dig a little deeper first? You can also share any tips (like files to focus on), or we can stop here.",
    );
  } else if (reason === "budget_exhausted") {
    lines.push(
      "Want us to keep going a bit longer, or stop here with what we have so far?",
    );
  } else if (reason === "verification_repair_capped") {
    lines.push(
      "Want us to take another pass at fixing the remaining issues, or stop here and keep the current changes?",
    );
  } else {
    lines.push("Want us to keep going, or stop here?");
  }

  return lines.join(" ");
}
