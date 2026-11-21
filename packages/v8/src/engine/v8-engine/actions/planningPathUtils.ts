/** Leaf path helpers for planning/discovery — keep free of shapedDiscovery imports. */
import { normalizeRepoPathText } from "../../../modules/repository-state";

export function normalizePlanningPath(value: string): string {
  return normalizeRepoPathText(value, {
    stripAtPrefix: true,
    emptyFallback: ".",
  });
}

export function isSafeRelativePlanningPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("~") &&
    !path.includes("..") &&
    !/^[A-Za-z]:\//.test(path)
  );
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
