import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ReviewDiffView } from './protocol.js';

const execFileAsync = promisify(execFile);

const MAX_FILE_DIFF_CHARS = 8_000;
const MAX_TOTAL_DIFF_CHARS = 48_000;

/** Build a review-mode diff snapshot from git status + short patch. */
export async function buildReviewDiff(
  workspaceRoot: string,
): Promise<ReviewDiffView> {
  let statusOut = '';
  let patchOut = '';
  try {
    const status = await execFileAsync(
      'git',
      ['status', '--porcelain', '-b'],
      { cwd: workspaceRoot, timeout: 10_000 },
    );
    statusOut = status.stdout.trim();
  } catch {
    return {
      summary: 'Unable to read git status.',
      files: [],
    };
  }
  try {
    const diff = await execFileAsync(
      'git',
      ['diff', '--stat', 'HEAD'],
      { cwd: workspaceRoot, timeout: 10_000 },
    );
    patchOut = diff.stdout.trim().slice(0, 4000);
  } catch {
    patchOut = '';
  }

  const files: ReviewDiffView['files'] = [];
  for (const line of statusOut.split('\n')) {
    if (!line || line.startsWith('##')) continue;
    const status = line.slice(0, 2).trim() || '?';
    const path = line.slice(3).trim().replace(/ -> /, ' → ').split(' → ').pop() ?? '';
    if (path) files.push({ path, status });
  }

  return {
    summary: statusOut.split('\n')[0] || '(no branch info)',
    files: files.slice(0, 40),
    patchPreview: patchOut || undefined,
  };
}

export type ReviewFileDiffInput = {
  path: string;
  diff: string;
  insertions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown';
};

/** Per-path unified diffs for ReviewPipeline.prepare (best-effort). */
export async function buildReviewFileDiffs(
  workspaceRoot: string,
  files: ReadonlyArray<{ path: string; status: string }>,
): Promise<ReviewFileDiffInput[]> {
  const out: ReviewFileDiffInput[] = [];
  let budget = MAX_TOTAL_DIFF_CHARS;

  for (const file of files.slice(0, 40)) {
    if (budget <= 0) break;
    const path = file.path.trim();
    if (!path || path.endsWith('/')) {
      out.push({
        path,
        diff: '',
        insertions: 0,
        deletions: 0,
        status: mapGitStatus(file.status),
      });
      continue;
    }

    const untracked = file.status.includes('?');
    let diffText = '';
    try {
      if (untracked) {
        const show = await execFileAsync(
          'git',
          ['diff', '--no-index', '--', '/dev/null', path],
          { cwd: workspaceRoot, timeout: 8_000 },
        );
        diffText = show.stdout;
      } else {
        const unstaged = await execFileAsync(
          'git',
          ['diff', '--', path],
          { cwd: workspaceRoot, timeout: 8_000 },
        );
        const staged = await execFileAsync(
          'git',
          ['diff', '--cached', '--', path],
          { cwd: workspaceRoot, timeout: 8_000 },
        );
        diffText = [staged.stdout, unstaged.stdout].filter(Boolean).join('\n');
        if (!diffText.trim()) {
          const vsHead = await execFileAsync(
            'git',
            ['diff', 'HEAD', '--', path],
            { cwd: workspaceRoot, timeout: 8_000 },
          );
          diffText = vsHead.stdout;
        }
      }
    } catch (error) {
      // git diff --no-index exits 1 when files differ; stdout still has the patch.
      const err = error as { stdout?: string; code?: number };
      if (typeof err.stdout === 'string' && err.stdout.length > 0) {
        diffText = err.stdout;
      } else {
        diffText = '';
      }
    }

    const capped = diffText.slice(0, Math.min(MAX_FILE_DIFF_CHARS, budget));
    budget -= capped.length;
    const { insertions, deletions } = countDiffStats(capped);
    out.push({
      path,
      diff: capped,
      insertions,
      deletions,
      status: mapGitStatus(file.status),
    });
  }

  return out;
}

function mapGitStatus(
  status: string,
): ReviewFileDiffInput['status'] {
  const normalized = status.trim();
  if (normalized.includes('?')) return 'added';
  if (normalized.includes('A')) return 'added';
  if (normalized.includes('D')) return 'deleted';
  if (normalized.includes('R')) return 'renamed';
  if (normalized.includes('C')) return 'copied';
  if (normalized.includes('M')) return 'modified';
  return 'unknown';
}

function countDiffStats(diff: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) insertions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { insertions, deletions };
}
