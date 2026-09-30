import {
  isSafeRelativePlanningPath,
  normalizePlanningPath,
  uniqueStrings,
} from "../planningContext";

export function extractGlobPathsFromToolOutput(output: unknown): string[] {
  const record = asRecord(output);
  const matches = record.matches;
  if (!Array.isArray(matches)) {
    return [];
  }
  const paths: string[] = [];
  for (const match of matches) {
    if (typeof match === "string") {
      paths.push(match);
      continue;
    }
    const item = asRecord(match);
    const path = asString(item.path);
    if (path) {
      paths.push(path);
    }
  }
  return normalizeDiscoveryPaths(paths);
}

export function extractSearchPathsFromToolOutput(output: unknown): string[] {
  const record = asRecord(output);
  const matches = record.matches;
  if (!Array.isArray(matches)) {
    return [];
  }
  const paths: string[] = [];
  for (const match of matches) {
    const item = asRecord(match);
    const path = asString(item.path);
    if (path) {
      paths.push(path);
    }
  }
  return normalizeDiscoveryPaths(paths);
}

function normalizeDiscoveryPaths(paths: readonly string[]): string[] {
  return uniqueStrings(
    paths
      .map(normalizePlanningPath)
      .filter((path) => isSafeRelativePlanningPath(path) && path.includes(".")),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
