/**
 * Git status / file diff for Desktop workspace panel.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  countDiffStats,
  inferStatusFromDiff,
  type DesktopFileChangeEntry,
  type DesktopFileChanges,
} from '../../shared/fileChanges.js';
import {
  flattenWorkingTreeFiles,
  parsePorcelainWorkingTree,
} from '../../shared/git/workingTree.js';

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
      ['status', '--porcelain=v1', '-z', '-uall', '-b'],
      { cwd: workspaceRoot, timeout: 45_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed = parsePorcelainWorkingTree(String(status.stdout ?? ''));
    const flat = flattenWorkingTreeFiles(parsed);
    const files: GitChangeFile[] = flat.map((f) => ({
      path: f.path,
      status: f.status,
    }));
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
      ...(parsed.branch ? { branch: parsed.branch } : {}),
      summary: parsed.summary || 'Git repository',
      files,
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

function stdoutFromExecError(err: unknown): string {
  if (err && typeof err === 'object' && 'stdout' in err) {
    return String((err as { stdout?: unknown }).stdout ?? '');
  }
  return '';
}

async function tryGitDiff(
  workspaceRoot: string,
  args: string[],
): Promise<string> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: workspaceRoot,
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (err) {
    return stdoutFromExecError(err).trim();
  }
}

/** Synthesize an add-only unified diff from file bytes (works without git). */
async function synthesizeAddDiff(
  workspaceRoot: string,
  relPath: string,
): Promise<string> {
  const absolute = path.resolve(workspaceRoot, relPath);
  let content: string;
  try {
    const buf = await fs.readFile(absolute);
    // Skip obvious binary (NUL in first 8KB).
    if (buf.includes(0)) return '';
    content = buf.toString('utf8');
  } catch {
    return '';
  }
  if (!content) {
    return `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relPath}\n`;
  }
  const lines = content.split(/\r?\n/);
  // Drop trailing empty from final newline so counts match editors.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const body = lines.map((line) => `+${line}`).join('\n');
  return [
    `diff --git a/${relPath} b/${relPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relPath}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    body,
  ].join('\n');
}

export async function getGitFileDiff(
  workspaceRoot: string,
  relPath: string,
): Promise<{ path: string; diff: string }> {
  const filePath = relPath.trim().replace(/\\/g, '/');
  if (!filePath) return { path: '', diff: '' };

  const unstaged = await tryGitDiff(workspaceRoot, ['diff', '--', filePath]);
  if (unstaged) {
    return { path: filePath, diff: unstaged.slice(0, 48_000) };
  }
  const staged = await tryGitDiff(workspaceRoot, [
    'diff',
    '--cached',
    '--',
    filePath,
  ]);
  if (staged) {
    return { path: filePath, diff: staged.slice(0, 48_000) };
  }
  const againstHead = await tryGitDiff(workspaceRoot, [
    'diff',
    'HEAD',
    '--',
    filePath,
  ]);
  if (againstHead) {
    return { path: filePath, diff: againstHead.slice(0, 48_000) };
  }

  // Untracked / new file — --no-index works even outside a git repo.
  const noIndex = await tryGitDiff(workspaceRoot, [
    'diff',
    '--no-index',
    '--',
    '/dev/null',
    filePath,
  ]);
  if (noIndex) {
    return { path: filePath, diff: noIndex.slice(0, 48_000) };
  }

  const synthesized = await synthesizeAddDiff(workspaceRoot, filePath);
  return { path: filePath, diff: synthesized.slice(0, 48_000) };
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

  for (const filePath of unique) {
    const { diff } = await getGitFileDiff(workspaceRoot, filePath);
    const stats = countDiffStats(diff);
    const status = inferStatusFromDiff(diff, 'M');
    totalAdditions += stats.additions;
    totalDeletions += stats.deletions;
    files.push({
      path: filePath,
      status,
      additions: stats.additions,
      deletions: stats.deletions,
      ...(diff ? { patchPreview: diff.slice(0, 6_000) } : {}),
    });
  }

  return { files, totalAdditions, totalDeletions };
}
