/**
 * Desktop Agent Working Tree contract (mitii-desktop/v1 git surface).
 *
 * Aligned with VS Code SCM: `git status --porcelain=v1 -z -uall -b`
 * (every untracked file listed; NUL-safe paths; rename = new then old).
 */

export type GitChangeGroup = 'staged' | 'changes' | 'untracked';

export interface GitWorkingTreeFile {
  path: string;
  /** Porcelain status letter for this group (M/A/D/R/C/?/…). */
  status: string;
  group: GitChangeGroup;
  /** Original path when status is rename/copy (VS Code renameResourceUri). */
  renameFrom?: string;
}

export interface GitWorkingTreeSnapshot {
  ok: boolean;
  branch?: string;
  summary: string;
  ahead?: number;
  behind?: number;
  staged: GitWorkingTreeFile[];
  changes: GitWorkingTreeFile[];
  untracked: GitWorkingTreeFile[];
  /** Flat union for badges / review pinning (deduped by path). */
  files: GitWorkingTreeFile[];
  /** Unique path count (matches VS Code SCM badge). */
  changeCount: number;
  statPreview?: string;
  error?: string;
}

export interface GitBranchListSnapshot {
  ok: boolean;
  current?: string;
  branches: string[];
  error?: string;
}

export interface GitMutationResult {
  ok: boolean;
  error?: string;
  /** Fresh status after a successful mutation. */
  status?: GitWorkingTreeSnapshot;
}

/** Soft cap so a pathological tree cannot OOM the renderer. */
export const GIT_WORKING_TREE_MAX_FILES = 5_000;

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

function byPath(a: GitWorkingTreeFile, b: GitWorkingTreeFile): number {
  return a.path.localeCompare(b.path);
}

function pushSorted(
  list: GitWorkingTreeFile[],
  file: GitWorkingTreeFile,
): void {
  list.push(file);
}

/**
 * Split porcelain into staged / changes / untracked (VS Code grouping).
 * Accepts NUL-separated (`-z`) or LF-separated output.
 */
export function parsePorcelainWorkingTree(stdout: string): {
  branch?: string;
  summary: string;
  ahead?: number;
  behind?: number;
  staged: GitWorkingTreeFile[];
  changes: GitWorkingTreeFile[];
  untracked: GitWorkingTreeFile[];
} {
  if (stdout.includes('\0')) {
    return parsePorcelainZ(stdout);
  }
  return parsePorcelainLines(stdout);
}

/** VS Code / `git status -z` parser. Rename entries: `R  new\0old\0`. */
function parsePorcelainZ(stdout: string): ReturnType<typeof parsePorcelainLines> {
  const parts = stdout.split('\0');
  const staged: GitWorkingTreeFile[] = [];
  const changes: GitWorkingTreeFile[] = [];
  const untracked: GitWorkingTreeFile[] = [];

  let branch: string | undefined;
  let summary = 'Git repository';
  let ahead: number | undefined;
  let behind: number | undefined;

  let i = 0;
  while (i < parts.length) {
    const entry = parts[i] ?? '';
    i += 1;
    if (!entry) continue;

    if (entry.startsWith('##')) {
      summary = entry.replace(/^##\s*/, '') || summary;
      branch = summary
        .split('...')[0]
        ?.trim()
        .replace(/^No commits yet on /, '');
      const ab = parseAheadBehind(summary);
      ahead = ab.ahead;
      behind = ab.behind;
      continue;
    }

    if (entry.startsWith('!!')) continue;

    if (entry.startsWith('??')) {
      const path = entry.slice(2).trimStart();
      if (path) pushSorted(untracked, { path, status: 'U', group: 'untracked' });
      continue;
    }

    if (entry.length < 3) continue;
    const indexStatus = entry[0] ?? ' ';
    const workTreeStatus = entry[1] ?? ' ';
    let path = entry.slice(3);
    let renameFrom: string | undefined;

    if (
      (indexStatus === 'R' ||
        indexStatus === 'C' ||
        workTreeStatus === 'R' ||
        workTreeStatus === 'C') &&
      i < parts.length
    ) {
      // -z order: first path is destination (new), next record is source (old).
      renameFrom = parts[i] ?? '';
      i += 1;
    }

    if (!path) continue;

    if (indexStatus !== ' ' && indexStatus !== '?') {
      pushSorted(staged, {
        path,
        status: indexStatus,
        group: 'staged',
        ...(renameFrom ? { renameFrom } : {}),
      });
    }
    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
      pushSorted(changes, {
        path,
        status: workTreeStatus,
        group: 'changes',
        ...(renameFrom && indexStatus === ' ' ? { renameFrom } : {}),
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
function parsePorcelainLines(stdout: string): {
  branch?: string;
  summary: string;
  ahead?: number;
  behind?: number;
  staged: GitWorkingTreeFile[];
  changes: GitWorkingTreeFile[];
  untracked: GitWorkingTreeFile[];
} {
  const lines = stdout.split(/\r?\n/).filter((l) => l.length > 0);
  const branchLine = lines.find((l) => l.startsWith('##')) ?? '';
  const summary = branchLine.replace(/^##\s*/, '') || 'Git repository';
  const branch = summary
    .split('...')[0]
    ?.trim()
    .replace(/^No commits yet on /, '');
  const { ahead, behind } = parseAheadBehind(summary);

  const staged: GitWorkingTreeFile[] = [];
  const changes: GitWorkingTreeFile[] = [];
  const untracked: GitWorkingTreeFile[] = [];

  for (const line of lines) {
    if (line.startsWith('##')) continue;
    if (line.startsWith('!!')) continue;

    if (line.startsWith('?? ')) {
      const path = unquotePath(line.slice(3).trim());
      if (path) untracked.push({ path, status: 'U', group: 'untracked' });
      continue;
    }

    if (line.length < 3) continue;
    const indexStatus = line[0] ?? ' ';
    const workTreeStatus = line[1] ?? ' ';
    const { path, renameFrom } = splitRenamePath(line.slice(3).trim());
    if (!path) continue;

    if (indexStatus !== ' ' && indexStatus !== '?') {
      staged.push({
        path,
        status: indexStatus,
        group: 'staged',
        ...(renameFrom ? { renameFrom } : {}),
      });
    }
    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
      changes.push({
        path,
        status: workTreeStatus,
        group: 'changes',
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
        c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c,
      );
  }
  return pathPart;
}

function splitRenamePath(pathPart: string): {
  path: string;
  renameFrom?: string;
} {
  if (!pathPart) return { path: '' };
  const arrow = pathPart.includes(' -> ')
    ? ' -> '
    : pathPart.includes(' → ')
      ? ' → '
      : null;
  if (!arrow) return { path: unquotePath(pathPart.trim()) };
  const [from, to] = pathPart.split(arrow);
  return {
    path: unquotePath((to ?? from ?? '').trim()),
    renameFrom: unquotePath((from ?? '').trim()) || undefined,
  };
}

export function flattenWorkingTreeFiles(
  snapshot: Pick<
    GitWorkingTreeSnapshot,
    'staged' | 'changes' | 'untracked'
  >,
): GitWorkingTreeFile[] {
  const seen = new Set<string>();
  const out: GitWorkingTreeFile[] = [];
  for (const file of [
    ...snapshot.staged,
    ...snapshot.changes,
    ...snapshot.untracked,
  ]) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push(file);
    if (out.length >= GIT_WORKING_TREE_MAX_FILES) break;
  }
  return out;
}
