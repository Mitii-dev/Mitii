import type { TaskList } from "../../../modules/task-list";
import type { EstablishedFact } from "./extractEstablishedFact";
import {
  isLoopFilePathFullyLoaded,
  type LoopFileReadTracker,
} from "./isExplorationRereadHeavy";
import { normalizeRepoPathText } from "../../../modules/repository-state";

/** Shim — owner is runtime/helpers/loop-rails/mutation-critic. */
export { extractMutationTargetPaths } from "../../../runtime/helpers/loop-rails/mutation-critic";

/**
 * mustRead paths on the active task that the mutation has not loaded yet.
 * Empty when the task has no mustRead, the mutation does not touch its write
 * files, or every need path is already in this-loop reads / established facts.
 */
export function missingMustReadPaths(params: {
  taskList?: TaskList;
  mutationPaths: readonly string[];
  loopFileReads?: LoopFileReadTracker;
  establishedFacts?: readonly EstablishedFact[];
}): string[] {
  const active = params.taskList?.items.find((item) => item.status === "active");
  const mustRead = uniquePaths(active?.mustRead ?? []);
  if (!active || mustRead.length === 0) {
    return [];
  }

  const mutation = uniquePaths(params.mutationPaths);
  if (mutation.length === 0) {
    return [];
  }
  const write = uniquePaths(active.write ?? []);
  if (write.length > 0 && !mutation.some((path) => write.includes(path))) {
    return [];
  }

  const loaded = (path: string) =>
    isPathLoaded(path, params.loopFileReads, params.establishedFacts);
  return mustRead.filter((path) => !loaded(path));
}

export function buildMustReadNudgeMessage(params: {
  missing: readonly string[];
  mutationPaths: readonly string[];
}): string {
  const need = params.missing.slice(0, 5).join(", ");
  const write = uniquePaths(params.mutationPaths).slice(0, 5).join(", ");
  return `Load ${need} before patching ${write || "the active write files"}. Do not expand into extra discovery.`;
}

function isPathLoaded(
  path: string,
  loopFileReads?: LoopFileReadTracker,
  establishedFacts?: readonly EstablishedFact[],
): boolean {
  const normalized = normalizeRepoPathText(path);
  if (!normalized) return false;
  if (isLoopFilePathFullyLoaded(loopFileReads, normalized)) {
    return true;
  }
  if (loopFileReads?.byPath.has(normalized)) {
    return false;
  }
  for (const fact of establishedFacts ?? []) {
    if (fact.id.includes(normalized) || fact.content.includes(normalized)) {
      return true;
    }
  }
  return false;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = normalizeRepoPathText(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

