import type { NormalizedWalkOptions, WalkState } from "./types";

function checkCancellation(
  options: NormalizedWalkOptions,
  state: WalkState,
  currentPath: string,
): boolean {
  if (!options.abortSignal?.aborted) {
    return false;
  }

  if (!state.cancelled) {
    state.cancelled = true;
    state.stopped = true;

    state.warnings.push({
      code: "cancelled",
      path: currentPath,
      message: "Workspace traversal was cancelled.",
    });
  }

  return true;
}

function checkTimeout(
  options: NormalizedWalkOptions,
  state: WalkState,
  currentPath: string,
): boolean {
  if (Date.now() < options.deadline) {
    return false;
  }

  state.timedOut = true;
  state.truncated = true;
  state.stopped = true;

  if (!state.reportedTimeout) {
    state.reportedTimeout = true;

    state.warnings.push({
      code: "timeout_reached",
      path: currentPath,
      message:
        `Workspace traversal exceeded its ` +
        `${options.timeoutMs}ms time limit.`,
    });
  }

  return true;
}

export function checkStop(
  options: NormalizedWalkOptions,
  state: WalkState,
  currentPath: string,
): boolean {
  if (checkCancellation(options, state, currentPath)) {
    return true;
  }

  return checkTimeout(options, state, currentPath);
}

export function stopForMaximumFiles(currentPath: string, state: WalkState): void {
  state.truncated = true;
  state.stopped = true;

  if (state.reportedMaximumFiles) {
    return;
  }

  state.reportedMaximumFiles = true;

  state.warnings.push({
    code: "maximum_files_reached",
    path: currentPath,
    message: "The maximum file limit was reached.",
  });
}

export function stopForMaximumDirectories(
  currentPath: string,
  state: WalkState,
): void {
  state.truncated = true;
  state.stopped = true;

  if (state.reportedMaximumDirectories) {
    return;
  }

  state.reportedMaximumDirectories = true;

  state.warnings.push({
    code: "maximum_directories_reached",
    path: currentPath,
    message: "The maximum directory limit was reached.",
  });
}
