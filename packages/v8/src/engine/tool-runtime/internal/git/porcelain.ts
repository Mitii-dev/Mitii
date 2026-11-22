/**
 * Shared `git status --porcelain=v1` parsers (-z and LF).
 * Single source for GitPort, Desktop SCM, CLI review, and VS Code review.
 */

export type GitPorcelainChangeGroup = "staged" | "changes" | "untracked";

export interface GitPorcelainFile {
  path: string;
  /** Porcelain status letter for this group (M/A/D/R/C/?/…). */
  status: string;
  group: GitPorcelainChangeGroup;
  /** Original path when status is rename/copy. */
  renameFrom?: string;
}

export interface GitPorcelainParseResult {
  branch?: string;
  summary: string;
  ahead?: number;
  behind?: number;
  staged: GitPorcelainFile[];
  changes: GitPorcelainFile[];
  untracked: GitPorcelainFile[];
}

/** Soft cap so a pathological tree cannot OOM hosts. */
export const GIT_PORCELAIN_MAX_FILES = 5_000;

/** Parse `## main...origin/main [ahead 1, behind 2]` style trailer. */
export function parseAheadBehind(branchLine: string): {
  ahead?: number;
  behind?: number;
} {
  const ahead = /\bahead\s+(\d+)/i.exec(branchLine);
  const behind = /\bbehind\s+(\d+)/i.exec(branchLine);
  return {
    ...(ahead ? { ahead: Number(ahead[1]) } : {}),
    ...(behind ? { behind: Number(behind[1]) } : {}),
  };
}

function byPath(a: GitPorcelainFile, b: GitPorcelainFile): number {
  return a.path.localeCompare(b.path);
}

function pushSorted(list: GitPorcelainFile[], file: GitPorcelainFile): void {
  list.push(file);
}

/**
 * Split porcelain into staged / changes / untracked (VS Code grouping).
 * Accepts NUL-separated (`-z`) or LF-separated output.
 */
export function parseGitPorcelain(stdout: string): GitPorcelainParseResult {
  if (stdout.includes("\0")) {
    return parsePorcelainZ(stdout);
  }
  return parsePorcelainLines(stdout);
}

/** Alias kept for Desktop call sites during migration. */
export const parsePorcelainWorkingTree = parseGitPorcelain;

/** VS Code / `git status -z` parser. Rename entries: `R  new\0old\0`. */
function parsePorcelainZ(stdout: string): GitPorcelainParseResult {
  const parts = stdout.split("\0");
  const staged: GitPorcelainFile[] = [];
  const changes: GitPorcelainFile[] = [];
  const untracked: GitPorcelainFile[] = [];

  let branch: string | undefined;
  let summary = "Git repository";
  let ahead: number | undefined;
  let behind: number | undefined;

  let i = 0;
  while (i < parts.length) {
    const entry = parts[i] ?? "";
    i += 1;
    if (!entry) continue;

    if (entry.startsWith("##")) {
      summary = entry.replace(/^##\s*/, "") || summary;
      branch = summary
        .split("...")[0]
        ?.trim()
        .replace(/^No commits yet on /, "");
      const ab = parseAheadBehind(summary);
      ahead = ab.ahead;
      behind = ab.behind;
      continue;
    }

    if (entry.startsWith("!!")) continue;

    if (entry.startsWith("??")) {
      const path = entry.slice(2).trimStart();
      if (path) {
        pushSorted(untracked, { path, status: "U", group: "untracked" });
      }
      continue;
    }

    if (entry.length < 3) continue;
    const indexStatus = entry[0] ?? " ";
    const workTreeStatus = entry[1] ?? " ";
    let path = entry.slice(3);
    let renameFrom: string | undefined;

    if (
      (indexStatus === "R" ||
        indexStatus === "C" ||
        workTreeStatus === "R" ||
        workTreeStatus === "C") &&
      i < parts.length
    ) {
      renameFrom = parts[i] ?? "";
      i += 1;
    }

    if (!path) continue;

    if (indexStatus !== " " && indexStatus !== "?") {
      pushSorted(staged, {
        path,
        status: indexStatus,
        group: "staged",
        ...(renameFrom ? { renameFrom } : {}),
      });
    }
    if (workTreeStatus !== " " && workTreeStatus !== "?") {
      pushSorted(changes, {
        path,
        status: workTreeStatus,
        group: "changes",
        ...(renameFrom && indexStatus === " " ? { renameFrom } : {}),
      });
    }
  }

  staged.sort(byPath);
  changes.sort(byPath);
  untracked.sort(byPath);

  return {
    ...(branch ? { branch } : {}),
    summary,
    ...(ahead !== undefined ? { ahead } : {}),
    ...(behind !== undefined ? { behind } : {}),
    staged,
    changes,
    untracked,
  };
}

/** LF porcelain (tests / fallback). Rename: `R  old -> new`. */
function parsePorcelainLines(stdout: string): GitPorcelainParseResult {
  const lines = stdout.split(/\r?\n/).filter((l) => l.length > 0);
  const branchLine = lines.find((l) => l.startsWith("##")) ?? "";
  const summary = branchLine.replace(/^##\s*/, "") || "Git repository";
  const branch = summary
    .split("...")[0]
    ?.trim()
    .replace(/^No commits yet on /, "");
  const { ahead, behind } = parseAheadBehind(summary);

  const staged: GitPorcelainFile[] = [];
  const changes: GitPorcelainFile[] = [];
  const untracked: GitPorcelainFile[] = [];

  for (const line of lines) {
    if (line.startsWith("##")) continue;
    if (line.startsWith("!!")) continue;

    if (line.startsWith("?? ") || line.startsWith("??")) {
      const path = unquotePath(
        line.startsWith("?? ") ? line.slice(3).trim() : line.slice(2).trimStart(),
      );
      if (path) untracked.push({ path, status: "U", group: "untracked" });
      continue;
    }

    if (line.length < 3) continue;
    const indexStatus = line[0] ?? " ";
    const workTreeStatus = line[1] ?? " ";
    const { path, renameFrom } = splitRenamePath(line.slice(3).trim());
    if (!path) continue;

    if (indexStatus !== " " && indexStatus !== "?") {
      staged.push({
        path,
        status: indexStatus,
        group: "staged",
        ...(renameFrom ? { renameFrom } : {}),
      });
    }
    if (workTreeStatus !== " " && workTreeStatus !== "?") {
      changes.push({
        path,
        status: workTreeStatus,
        group: "changes",
      });
    }
  }

  staged.sort(byPath);
  changes.sort(byPath);
  untracked.sort(byPath);

  return {
    ...(branch ? { branch } : {}),
    summary,
    ...(ahead !== undefined ? { ahead } : {}),
    ...(behind !== undefined ? { behind } : {}),
    staged,
    changes,
    untracked,
  };
}

function unquotePath(pathPart: string): string {
  if (
    pathPart.length >= 2 &&
    pathPart.startsWith('"') &&
    pathPart.endsWith('"')
  ) {
    return pathPart
      .slice(1, -1)
      .replace(/\\([\\"nrt])/g, (_, c: string) =>
        c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
      );
  }
  return pathPart;
}

function splitRenamePath(pathPart: string): {
  path: string;
  renameFrom?: string;
} {
  if (!pathPart) return { path: "" };
  const arrow = pathPart.includes(" -> ")
    ? " -> "
    : pathPart.includes(" → ")
      ? " → "
      : null;
  if (!arrow) return { path: unquotePath(pathPart.trim()) };
  const [from, to] = pathPart.split(arrow);
  return {
    path: unquotePath((to ?? from ?? "").trim()),
    renameFrom: unquotePath((from ?? "").trim()) || undefined,
  };
}

export function flattenPorcelainFiles(
  snapshot: Pick<
    GitPorcelainParseResult,
    "staged" | "changes" | "untracked"
  >,
  maxFiles: number = GIT_PORCELAIN_MAX_FILES,
): GitPorcelainFile[] {
  const seen = new Set<string>();
  const out: GitPorcelainFile[] = [];
  for (const file of [
    ...snapshot.staged,
    ...snapshot.changes,
    ...snapshot.untracked,
  ]) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push(file);
    if (out.length >= maxFiles) break;
  }
  return out;
}

/** Map porcelain groups into GitPort `status` path lists. */
export function gitStatusPathsFromPorcelain(
  parsed: GitPorcelainParseResult,
  raw: string,
): {
  branch?: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  raw: string;
} {
  return {
    ...(parsed.branch ? { branch: parsed.branch } : {}),
    staged: parsed.staged.map((f) => f.path),
    unstaged: parsed.changes.map((f) => f.path),
    untracked: parsed.untracked.map((f) => f.path),
    raw,
  };
}

export type GitPorcelainReviewStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "unknown";

export interface GitPorcelainReviewEntry {
  path: string;
  status: GitPorcelainReviewStatus;
  untracked?: boolean;
  renameFrom?: string;
}

function reviewStatusFromLetter(letter: string): GitPorcelainReviewStatus {
  switch (letter) {
    case "D":
      return "deleted";
    case "A":
      return "added";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
    case "?":
      return "added";
    default:
      return "modified";
  }
}

/** Flat review-oriented entries from porcelain (CLI / VS Code review). */
export function porcelainToReviewEntries(
  parsed: GitPorcelainParseResult,
): GitPorcelainReviewEntry[] {
  const out: GitPorcelainReviewEntry[] = [];
  const seen = new Set<string>();

  for (const file of parsed.untracked) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push({ path: file.path, status: "added", untracked: true });
  }
  for (const file of [...parsed.staged, ...parsed.changes]) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push({
      path: file.path,
      status: reviewStatusFromLetter(file.status),
      ...(file.renameFrom ? { renameFrom: file.renameFrom } : {}),
    });
  }
  return out;
}
