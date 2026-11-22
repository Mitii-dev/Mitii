/**
 * Inject trusted execution-seed paths onto the live checklist when write/mustRead
 * are empty so mutate-readiness has a concrete recipe.
 */
import type { TaskList } from "../../../../modules/task-list";

import type { ExecutionSeed } from "../execution-seed";
import { isExecutionSeedTrusted } from "../execution-seed";

const MAX_SEED_WRITE = 6;

export function applyExecutionSeedToTaskList(params: {
  taskList: TaskList | undefined;
  seed: ExecutionSeed | undefined;
}): { taskList: TaskList | undefined; applied: boolean } {
  const { taskList, seed } = params;
  if (!taskList || !isExecutionSeedTrusted(seed) || !seed || seed.paths.length === 0) {
    return { taskList, applied: false };
  }

  const seedPaths = uniquePaths(seed.paths).slice(0, MAX_SEED_WRITE);
  if (seedPaths.length === 0) {
    return { taskList, applied: false };
  }

  let applied = false;
  const items = taskList.items.map((item, index) => {
    const write = uniquePaths(item.write ?? []);
    const mustRead = uniquePaths(item.mustRead ?? []);
    if (write.length > 0) {
      return item;
    }
    // Prefer the active (or first) row for seed write targets.
    if (item.status !== "active" && !(index === 0 && !taskList.items.some((row) => row.status === "active"))) {
      return item;
    }
    applied = true;
    return {
      ...item,
      write: seedPaths,
      mustRead: mustRead.length > 0 ? mustRead : seedPaths,
    };
  });

  if (!applied) {
    return { taskList, applied: false };
  }

  return {
    taskList: {
      ...taskList,
      items,
    },
    applied: true,
  };
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const normalized = path
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "");
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}
