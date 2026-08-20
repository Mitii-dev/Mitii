import type { TaskList } from "../contracts";

const FILE_LIKE_PATH = /[A-Za-z0-9_./\\-]+\.\w{1,16}\b/g;

/**
 * Paths this row owns. Prefer explicit write/mustRead/affected; fall back to
 * file-like tokens in title/detail so agent-created todos can still stub.
 */
export function taskItemPaths(item: {
  title: string;
  detail?: string;
  write?: readonly string[];
  mustRead?: readonly string[];
  affected?: readonly string[];
}): string[] {
  const fromFields = uniquePaths([
    ...(item.write ?? []),
    ...(item.mustRead ?? []),
    ...(item.affected ?? []),
  ]);
  if (fromFields.length > 0) {
    return fromFields;
  }
  const hint = `${item.title} ${item.detail ?? ""}`;
  return uniquePaths(hint.match(FILE_LIKE_PATH) ?? []);
}

/**
 * Paths from done/skipped rows that no remaining row still needs.
 * Engine stubs those file bodies out of the live transcript.
 */
export function collectCompletedTaskPaths(taskList?: TaskList): string[] {
  if (!taskList || taskList.items.length === 0) {
    return [];
  }
  const stillNeeded = new Set<string>();
  const completed = new Set<string>();
  for (const item of taskList.items) {
    const paths = taskItemPaths(item);
    if (item.status === "done" || item.status === "skipped") {
      for (const path of paths) {
        completed.add(path);
      }
    } else {
      for (const path of paths) {
        stillNeeded.add(path);
      }
    }
  }
  return [...completed].filter((path) => !stillNeeded.has(path));
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = path.trim().replace(/\\/g, "/");
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}
