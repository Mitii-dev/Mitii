import type { GitService } from '../../../features/ce/context/GitService';
import type { CommitMessageInput } from './commitMessageTypes';

export async function collectCommitMessageInput(
  git: GitService,
  options: {
    scope?: string;
    stagedDiffMaxChars?: number;
    unstagedDiffMaxChars?: number;
    perFileMaxChars?: number;
  } = {}
): Promise<CommitMessageInput> {
  const stagedDiffMaxChars = options.stagedDiffMaxChars ?? 16_000;
  const unstagedDiffMaxChars = options.unstagedDiffMaxChars ?? 8_000;
  const stagedCollectionMaxChars = Math.min(1_000_000, Math.max(stagedDiffMaxChars * 32, 128_000));
  const unstagedCollectionMaxChars = Math.min(500_000, Math.max(unstagedDiffMaxChars * 16, 64_000));
  const [stagedDiff, unstagedDiff, changedFiles, recentCommits, branch] = await Promise.all([
    // Fetch beyond the final prompt budget so one large first file does not
    // prevent later staged files from being represented by budgetDiff().
    git.getStagedDiff(stagedCollectionMaxChars),
    git.getUnstagedDiff(unstagedCollectionMaxChars),
    git.getChangedFilesDetailed(true),
    git.getRecentCommits(5),
    git.getCurrentBranch(),
  ]);

  return {
    stagedDiff: budgetDiff(stagedDiff, {
      totalMaxChars: stagedDiffMaxChars,
      perFileMaxChars: options.perFileMaxChars,
    }),
    unstagedDiff: budgetDiff(unstagedDiff, {
      totalMaxChars: unstagedDiffMaxChars,
      perFileMaxChars: options.perFileMaxChars,
    }),
    changedFiles,
    recentCommits,
    branch,
    scope: options.scope,
  };
}

export function budgetDiff(
  diff: string,
  options: { totalMaxChars: number; perFileMaxChars?: number }
): string {
  if (!diff || diff.length <= options.totalMaxChars && !options.perFileMaxChars) {
    return diff;
  }

  const perFileMax = options.perFileMaxChars ?? options.totalMaxChars;
  const files = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const budgeted = files.map((fileDiff) => {
    if (fileDiff.length <= perFileMax) return fileDiff;
    const header = fileDiff
      .split(/\r?\n/)
      .filter((line) => /^(diff --git|index |--- |\+\+\+ |@@ )/.test(line))
      .join('\n');
    return `${header}\n[diff truncated: ${fileDiff.length - header.length} chars omitted]\n`;
  }).join('');

  if (budgeted.length <= options.totalMaxChars) return budgeted;
  return `${budgeted.slice(0, options.totalMaxChars)}\n[diff truncated: ${budgeted.length - options.totalMaxChars} chars omitted]\n`;
}
