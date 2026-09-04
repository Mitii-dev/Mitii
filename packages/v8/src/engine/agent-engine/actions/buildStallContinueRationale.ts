import type { TaskList } from "../../../modules/task-list";

/**
 * User-facing summary when exploration stalls after partial progress on a large task.
 */
export function buildStallContinueRationale(params: {
  changedFiles: readonly string[];
  taskList?: TaskList;
  answer?: string;
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
}): string {
  const lines: string[] = [
    "This task looks large and the run stalled after repeated file re-reads.",
  ];

  if (params.changedFiles.length > 0) {
    const preview = params.changedFiles.slice(0, 8).join(", ");
    const more =
      params.changedFiles.length > 8
        ? ` (+${params.changedFiles.length - 8} more)`
        : "";
    lines.push(
      `Completed so far: ${params.changedFiles.length} file(s) changed (${preview}${more}).`,
    );
  }

  if (params.taskList) {
    const pending = params.taskList.items.filter(
      (item) => item.status !== "done" && item.status !== "skipped",
    );
    if (pending.length > 0) {
      const titles = pending
        .slice(0, 5)
        .map((item) => item.title.trim())
        .filter((title) => title.length > 0);
      lines.push(
        `Still pending: ${pending.length} checklist item(s)${titles.length > 0 ? ` — ${titles.join("; ")}` : ""}.`,
      );
    }
  }

  lines.push(
    `Exploration signal: ${params.fileReadCalls} file reads across ${params.uniqueFilePathsTouched} unique paths.`,
    "Continue to keep working, or stop here.",
  );

  return lines.join(" ");
}

export function shouldOfferStallContinue(params: {
  changedFiles: readonly string[];
  taskList?: TaskList;
  mutationRequired: boolean;
}): boolean {
  if (params.changedFiles.length > 0) {
    return true;
  }
  if (params.taskList) {
    const pending = params.taskList.items.some(
      (item) => item.status !== "done" && item.status !== "skipped",
    );
    if (pending) {
      return true;
    }
  }
  if (params.mutationRequired) {
    return false;
  }
  return false;
}
