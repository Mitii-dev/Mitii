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

/**
 * Normalize workspace-relative paths for checklist matching.
 * `src/a.ts` and `packages/mui-builder/src/a.ts` compare equal via suffix.
 */
export function normalizeTaskPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * True when a mutation path belongs to a checklist-owned path.
 * Exact match or either side is a suffix of the other (package-prefixed writes).
 */
export function taskPathsMatch(owned: string, changed: string): boolean {
  const left = normalizeTaskPath(owned).toLowerCase();
  const right = normalizeTaskPath(changed).toLowerCase();
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return (
    left.endsWith(`/${right}`) ||
    right.endsWith(`/${left}`) ||
    left.endsWith(right) ||
    right.endsWith(left)
  );
}

export function itemMentionsAnyPath(
  item: {
    title: string;
    detail?: string;
    write?: readonly string[];
    mustRead?: readonly string[];
    affected?: readonly string[];
  },
  paths: readonly string[],
): boolean {
  if (paths.length === 0) {
    return false;
  }
  // Mutation auto-advance prefers write targets so reference/template
  // mustRead paths (source package) do not block completing the row.
  if (itemWriteTargetsMatchChangedFiles(item, paths)) {
    return true;
  }
  const owned = taskItemPaths(item);
  if (owned.length > 0) {
    return paths.some((changed) =>
      owned.some((path) => taskPathsMatch(path, changed)),
    );
  }
  const hint = `${item.title} ${item.detail ?? ""}`.toLowerCase();
  return paths.some((changed) => {
    const normalized = normalizeTaskPath(changed).toLowerCase();
    if (normalized.length === 0) {
      return false;
    }
    return (
      hint.includes(normalized) ||
      hint.includes(normalized.split("/").pop() ?? "")
    );
  });
}

/**
 * True when changed files hit this row's write targets.
 *
 * When `write` is present, only those paths (or package-prefixed equivalents)
 * complete the row — sibling files under the same package root do not.
 * Package-root matching is reserved for Scope-only rows with empty `write`.
 */
export function itemWriteTargetsMatchChangedFiles(
  item: {
    title: string;
    detail?: string;
    write?: readonly string[];
  },
  changedFiles: readonly string[],
): boolean {
  if (changedFiles.length === 0) {
    return false;
  }
  const write = uniquePaths(item.write ?? []);
  if (write.length > 0) {
    return changedFiles.some((changed) =>
      write.some((path) => taskPathsMatch(path, changed)),
    );
  }

  const packageRoots = collectPackageRoots(
    `${item.title} ${item.detail ?? ""}`.match(/packages\/[A-Za-z0-9._-]+/g) ??
      [],
  );
  if (packageRoots.length === 0) {
    return false;
  }
  return changedFiles.some((changed) => {
    const normalized = normalizeTaskPath(changed).toLowerCase();
    return packageRoots.some(
      (root) =>
        normalized === root ||
        normalized.startsWith(`${root}/`),
    );
  });
}

function collectPackageRoots(paths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const normalized = normalizeTaskPath(path).toLowerCase();
    const match = normalized.match(/^(packages\/[^/]+)/);
    if (match?.[1]) {
      roots.add(match[1]);
    }
  }
  return [...roots];
}

/**
 * Pull a TypeScript / compiler diagnostic code from a plan step title.
 * Examples: "Fix TS2339 in …", "Fix 2305 in FormBuilder".
 */
export function extractDiagnosticCodeHint(text: string): string | undefined {
  const ts = text.match(/\bTS(\d{4})\b/i);
  if (ts?.[1]) {
    return `TS${ts[1]}`;
  }
  // Bare 4-digit codes next to Fix / diagnostic language (avoid years/ports).
  const bare = text.match(
    /\b(?:fix|address|resolve|clear)\b[^.\n]{0,40}\b(\d{4})\b/i,
  );
  if (bare?.[1]) {
    return `TS${bare[1]}`;
  }
  return undefined;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = normalizeTaskPath(path);
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}
