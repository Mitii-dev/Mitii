import type { TaskList } from "../../../modules/task-list";
import type { EstablishedFact } from "./extractEstablishedFact";
import type { LoopFileReadTracker } from "./isExplorationRereadHeavy";

const MUTATION_PATH_TOOLS = new Set([
  "apply_patch",
  "delete_file",
  "delete_directory",
  "move_file",
]);

/**
 * Paths a mutating tool is about to change. Used only for the must-read
 * nudge — not for exploration metrics.
 */
export function extractMutationTargetPaths(
  toolName: string,
  argumentsValue: unknown,
): string[] {
  if (!MUTATION_PATH_TOOLS.has(toolName)) {
    return [];
  }
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return [];
  }
  const record = argumentsValue as Record<string, unknown>;
  if (toolName === "apply_patch" && Array.isArray(record.patches)) {
    return uniquePaths(
      record.patches.flatMap((patch) =>
        patch &&
        typeof patch === "object" &&
        typeof (patch as { path?: unknown }).path === "string"
          ? [(patch as { path: string }).path]
          : [],
      ),
    );
  }
  if (toolName === "move_file" && typeof record.from === "string") {
    return uniquePaths([record.from]);
  }
  if (typeof record.path === "string") {
    return uniquePaths([record.path]);
  }
  return [];
}

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
  if (loopFileReads) {
    for (const candidate of loopFileReads.paths) {
      if (normalizePath(candidate) === path) {
        return true;
      }
    }
  }
  for (const fact of establishedFacts ?? []) {
    if (fact.id.includes(path) || fact.content.includes(path)) {
      return true;
    }
  }
  return false;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}
