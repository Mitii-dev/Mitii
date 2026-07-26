import type { GitService } from '../../../features/ce/context/GitService';
import { redactSensitiveDiff } from './commitMessagePrompt';
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
    // Fetch beyond the final prompt budget; buildCommitMessagePrompt performs
    // the authoritative redacted, per-file budget pass.
    git.getStagedDiff(stagedCollectionMaxChars),
    git.getUnstagedDiff(unstagedCollectionMaxChars),
    git.getChangedFilesDetailed(true),
    git.getRecentCommits(5),
    git.getCurrentBranch(),
  ]);

  return {
    stagedDiff: redactSensitiveDiff(stagedDiff),
    unstagedDiff: budgetDiff(redactSensitiveDiff(unstagedDiff), {
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
  const totalMaxChars = Math.max(0, options.totalMaxChars);
  if (!diff || diff.length <= totalMaxChars && !options.perFileMaxChars) {
    return diff;
  }

  const files = diff.split(/(?=^diff --git )/m).filter(Boolean);
  if (files.length === 0) return diff.slice(0, totalMaxChars);

  const perFileMax = options.perFileMaxChars ?? Math.max(1, Math.floor(totalMaxChars / files.length));
  const chunks = files.map((fileDiff) => truncateFileDiff(fileDiff, perFileMax));
  const rendered: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const chunk of chunks) {
    if (used >= totalMaxChars) {
      omitted += 1;
      continue;
    }
    const remaining = totalMaxChars - used;
    if (chunk.length > remaining) {
      const marker = `\n[diff truncated: ${chunk.length - remaining} chars omitted]\n`;
      if (remaining > marker.length + 20) {
        rendered.push(`${chunk.slice(0, remaining - marker.length)}${marker}`);
        used = totalMaxChars;
      } else {
        omitted += 1;
      }
      continue;
    }
    rendered.push(chunk);
    used += chunk.length;
  }
  if (omitted > 0 && used < totalMaxChars) {
    rendered.push(`[diff truncated: ${omitted} file sections omitted]`);
  }

  return rendered.join('');
}

function truncateFileDiff(fileDiff: string, perFileMax: number): string {
  if (fileDiff.length <= perFileMax) return fileDiff;
  const header = fileDiff
    .split(/\r?\n/)
    .filter((line) => /^(diff --git|index |--- |\+\+\+ |@@ )/.test(line))
    .join('\n');
  const remaining = Math.max(0, perFileMax - header.length - 48);
  const hunkStart = fileDiff.indexOf('@@');
  const bodyStart = hunkStart >= 0 ? fileDiff.indexOf('\n', hunkStart) + 1 : -1;
  const body = bodyStart > 0 ? fileDiff.slice(bodyStart, bodyStart + remaining) : '';
  return `${header}\n${body}\n[diff truncated: ${fileDiff.length - header.length - remaining} chars omitted]\n`;
}
