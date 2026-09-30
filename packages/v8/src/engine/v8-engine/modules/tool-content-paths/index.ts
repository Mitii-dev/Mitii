/**
 * Paths associated with a read-only tool result for path-aware content-cache
 * invalidation. Range suffixes (`path:12-40`) are stripped for overlap checks
 * against mutation `changedFiles`.
 */

const PATH_KEYS = ["path", "from", "to", "directory", "cwd", "root"] as const;

export function extractToolContentPaths(
  toolName: string,
  argumentsValue: unknown,
): string[] {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return [];
  }
  const record = argumentsValue as Record<string, unknown>;
  const found: string[] = [];

  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      found.push(normalizeRepoPath(value));
    }
  }

  if (Array.isArray(record.paths)) {
    for (const path of record.paths) {
      if (typeof path === "string" && path.trim().length > 0) {
        found.push(normalizeRepoPath(path));
      }
    }
  }

  if (toolName === "apply_patch" && Array.isArray(record.patches)) {
    for (const patch of record.patches) {
      if (
        patch &&
        typeof patch === "object" &&
        typeof (patch as { path?: unknown }).path === "string"
      ) {
        found.push(normalizeRepoPath((patch as { path: string }).path));
      }
    }
  }

  return unique(found);
}

/** Bare path without `:start-end` range suffix used by exploration metrics. */
export function stripPathRangeSuffix(path: string): string {
  const normalized = normalizeRepoPath(path);
  const rangeMatch = normalized.match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!rangeMatch?.[1]) {
    return normalized;
  }
  const base = rangeMatch[1];
  // Keep Windows drive roots like `C:` untouched.
  if (/^[A-Za-z]$/.test(base)) {
    return normalized;
  }
  return base;
}

/**
 * True when a cached content entry's paths overlap any mutated path.
 * Directory listings of a parent of a changed file also invalidate.
 */
export function toolContentPathsOverlap(
  entryPaths: readonly string[],
  changedFiles: readonly string[],
): boolean {
  if (entryPaths.length === 0 || changedFiles.length === 0) {
    return false;
  }
  const changed = changedFiles.map(stripPathRangeSuffix).filter(Boolean);
  const entries = entryPaths.map(stripPathRangeSuffix).filter(Boolean);
  for (const entry of entries) {
    for (const file of changed) {
      if (entry === file) {
        return true;
      }
      if (file.startsWith(`${entry}/`) || entry.startsWith(`${file}/`)) {
        return true;
      }
    }
  }
  return false;
}

export function normalizeRepoPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function unique(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push(path);
  }
  return out;
}
