/**
 * Desktop Agent Working Tree contract (mitii-desktop/v1 git surface).
 *
 * Intentionally thinner than VS Code SCM: branch + stage/commit + Mitii recipes.
 * GitPort in V8 stays read-only; mutations live in the desktop engine only.
 */

export type GitChangeGroup = 'staged' | 'changes' | 'untracked';

export interface GitWorkingTreeFile {
  path: string;
  /** Porcelain XY code (or single letter for display). */
  status: string;
  group: GitChangeGroup;
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
  /** Flat union for badges / review pinning (deduped). */
  files: GitWorkingTreeFile[];
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

/**
 * Split porcelain v1 lines into staged / changes / untracked.
 * Index letter → staged; worktree letter → changes; `??` → untracked.
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
  const lines = stdout.split(/\r?\n/).filter((l) => l.length > 0);
  const branchLine = lines.find((l) => l.startsWith('##')) ?? '';
  const summary = branchLine.replace(/^##\s*/, '') || 'Git repository';
  const branch = summary.split('...')[0]?.trim().replace(/^No commits yet on /, '');
  const { ahead, behind } = parseAheadBehind(summary);

  const staged: GitWorkingTreeFile[] = [];
  const changes: GitWorkingTreeFile[] = [];
  const untracked: GitWorkingTreeFile[] = [];

  for (const line of lines) {
    if (line.startsWith('##')) continue;

    if (line.startsWith('?? ')) {
      const path = normalizeRenamePath(line.slice(3).trim());
      if (path) untracked.push({ path, status: '?', group: 'untracked' });
      continue;
    }

    if (line.length < 3) continue;
    const indexStatus = line[0] ?? ' ';
    const workTreeStatus = line[1] ?? ' ';
    const path = normalizeRenamePath(line.slice(3).trim());
    if (!path) continue;

    if (indexStatus !== ' ' && indexStatus !== '?') {
      staged.push({ path, status: indexStatus, group: 'staged' });
    }
    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
      changes.push({ path, status: workTreeStatus, group: 'changes' });
    }
  }

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

function normalizeRenamePath(pathPart: string): string {
  if (!pathPart) return '';
  const arrow = pathPart.includes(' -> ')
    ? ' -> '
    : pathPart.includes(' → ')
      ? ' → '
      : null;
  if (!arrow) return pathPart.trim();
  return pathPart.split(arrow).at(-1)?.trim() ?? pathPart.trim();
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
  }
  return out.slice(0, 120);
}
