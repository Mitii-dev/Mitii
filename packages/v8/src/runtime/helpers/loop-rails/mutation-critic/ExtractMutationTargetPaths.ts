/**
 * Paths a mutating tool is about to change (must-read / critic scope).
 */
import { normalizeRepoPathText } from "../../../../modules/repository-state";

const MUTATION_PATH_TOOLS = new Set([
  "apply_patch",
  "delete_file",
  "delete_directory",
  "move_file",
]);

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
  if (toolName === "apply_patch") {
    const fromPatches = Array.isArray(record.patches)
      ? record.patches.flatMap((patch) =>
          patch &&
          typeof patch === "object" &&
          typeof (patch as { path?: unknown }).path === "string"
            ? [(patch as { path: string }).path]
            : [],
        )
      : [];
    if (typeof record.path === "string") {
      fromPatches.push(record.path);
    }
    return uniquePaths(fromPatches);
  }
  if (toolName === "move_file") {
    const paths: string[] = [];
    if (typeof record.from === "string") paths.push(record.from);
    if (typeof record.to === "string") paths.push(record.to);
    return uniquePaths(paths);
  }
  if (typeof record.path === "string") {
    return uniquePaths([record.path]);
  }
  return [];
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
