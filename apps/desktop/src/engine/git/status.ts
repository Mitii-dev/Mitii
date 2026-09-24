/**
 * Git status / file diff for Desktop workspace panel.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  countDiffStats,
  inferStatusFromDiff,
  type DesktopFileChangeEntry,
  type DesktopFileChanges,
} from '../../shared/fileChanges.js';

const execFileAsync = promisify(execFile);

export interface GitChangeFile {
  path: string;
  status: string;
}

export interface GitStatusSnapshot {
  ok: boolean;
  branch?: string;
  summary: string;
  files: GitChangeFile[];
  statPreview?: string;
  error?: string;
}

export async function getGitStatus(
  workspaceRoot: string,
): Promise<GitStatusSnapshot> {
  try {
    const status = await execFileAsync(
      'git',
      ['status', '--porcelain', '-b'],
      { cwd: workspaceRoot, timeout: 10_000 },
    );
    const lines = status.stdout.trim().split('\n').filter(Boolean);
    const branchLine = lines.find((l) => l.startsWith('##')) ?? '';
    const branch = branchLine.replace(/^##\s*/, '').split('...')[0]?.trim();
    const files: GitChangeFile[] = [];
    for (const line of lines) {
      if (line.startsWith('##')) continue;
      const code = line.slice(0, 2).trim() || '?';
      const path =
        line.slice(3).trim().replace(/ -> /, ' → ').split(' → ').pop() ?? '';
      if (path) files.push({ path, status: code });
    }
    let statPreview: string | undefined;
    try {
      const diff = await execFileAsync('git', ['diff', '--stat', 'HEAD'], {
        cwd: workspaceRoot,
        timeout: 10_000,
      });
      statPreview = diff.stdout.trim().slice(0, 4000) || undefined;
    } catch {
      statPreview = undefined;
    }
    return {
      ok: true,
      ...(branch ? { branch } : {}),
      summary: branchLine.replace(/^##\s*/, '') || 'Git repository',
      files: files.slice(0, 80),
      ...(statPreview ? { statPreview } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      summary: 'Not a git repository (or git unavailable).',
      files: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getGitFileDiff(
  workspaceRoot: string,
  relPath: string,
): Promise<{ path: string; diff: string }> {
  const path = relPath.trim();
  if (!path) return { path: '', diff: '' };
  try {
    const unstaged = await execFileAsync(
      'git',
      ['diff', '--', path],
      { cwd: workspaceRoot, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (unstaged.stdout.trim()) {
      return { path, diff: unstaged.stdout.slice(0, 48_000) };
    }
    const staged = await execFileAsync(
      'git',
      ['diff', '--cached', '--', path],
      { cwd: workspaceRoot, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (staged.stdout.trim()) {
      return { path, diff: staged.stdout.slice(0, 48_000) };
    }
    const show = await execFileAsync(
      'git',
      ['diff', 'HEAD', '--', path],
      { cwd: workspaceRoot, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (show.stdout.trim()) {
      return { path, diff: show.stdout.slice(0, 48_000) };
    }
    // Untracked / new file — synthesize an add-only unified diff.
    try {
      const untracked = await execFileAsync(
        'git',
        ['diff', '--no-index', '--', '/dev/null', path],
        { cwd: workspaceRoot, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
      );
      if (untracked.stdout.trim()) {
        return { path, diff: untracked.stdout.slice(0, 48_000) };
      }
    } catch (err: unknown) {
      // git diff --no-index exits 1 when files differ (expected).
      const stdout =
        err && typeof err === 'object' && 'stdout' in err
          ? String((err as { stdout?: unknown }).stdout ?? '')
          : '';
      if (stdout.trim()) {
        return { path, diff: stdout.slice(0, 48_000) };
      }
    }
    return { path, diff: '' };
  } catch {
    return { path, diff: '' };
  }
}

/** Build a chat-facing summary of changed files (diffs + line stats). */
export async function getGitFileChangesSummary(
  workspaceRoot: string,
  paths: string[],
): Promise<DesktopFileChanges> {
  const unique = [
    ...new Set(paths.map((p) => p.replace(/\\/g, '/').trim()).filter(Boolean)),
  ].slice(0, 40);

  const files: DesktopFileChangeEntry[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const path of unique) {
    const { diff } = await getGitFileDiff(workspaceRoot, path);
    const stats = countDiffStats(diff);
    const status = inferStatusFromDiff(diff, 'M');
    totalAdditions += stats.additions;
    totalDeletions += stats.deletions;
    files.push({
      path,
      status,
      additions: stats.additions,
      deletions: stats.deletions,
      ...(diff
        ? { patchPreview: diff.slice(0, 6_000) }
        : {}),
    });
  }

  return { files, totalAdditions, totalDeletions };
}
