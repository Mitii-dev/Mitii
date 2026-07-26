import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ReviewDiffView } from './protocol.js';

const execFileAsync = promisify(execFile);

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
    const path = line.slice(3).trim();
    if (path) files.push({ path, status });
  }

  return {
    summary: statusOut.split('\n')[0] || '(no branch info)',
    files: files.slice(0, 40),
    patchPreview: patchOut || undefined,
  };
}
