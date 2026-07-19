import type { GitService } from '../../../features/ce/context/GitService';
import { budgetDiff } from './GitDiffCollector';

export interface ReviewDiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string;
}

export interface ReviewDiff {
  branch: string | null;
  files: ReviewDiffFile[];
  summary: {
    fileCount: number;
    additions: number;
    deletions: number;
  };
  truncated: boolean;
  updatedAt: number;
}

export async function collectReviewDiff(
  git: GitService,
  options: { totalMaxChars?: number; perFileMaxChars?: number } = {}
): Promise<ReviewDiff> {
  const totalMaxChars = options.totalMaxChars ?? 32_000;
  const perFileMaxChars = options.perFileMaxChars ?? 8_000;
  const [branch, changedFiles, stagedDiff, unstagedDiff] = await Promise.all([
    git.getCurrentBranch(),
    git.getChangedFilesDetailed(),
    git.getStagedDiff(totalMaxChars),
    git.getUnstagedDiff(totalMaxChars),
  ]);

  const combined = [stagedDiff, unstagedDiff].filter(Boolean).join('\n');
  const budgeted = budgetDiff(combined, { totalMaxChars, perFileMaxChars });
  const files = parseReviewDiffFiles(budgeted, changedFiles);
  return {
    branch,
    files,
    summary: {
      fileCount: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
    truncated: combined.length > budgeted.length || /\[diff truncated:/.test(budgeted),
    updatedAt: Date.now(),
  };
}

export function parseReviewDiffFiles(diff: string, changedFiles: string[] = []): ReviewDiffFile[] {
  const statusByPath = new Map<string, string>();
  for (const line of changedFiles) {
    const [status, ...pathParts] = line.split(/\s+/);
    const path = pathParts[pathParts.length - 1];
    if (status && path) statusByPath.set(path, status);
  }

  const chunks = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const parsed = chunks.map((chunk) => {
    const path = parseDiffPath(chunk);
    const additions = chunk.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
    const deletions = chunk.split(/\r?\n/).filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
    return {
      path,
      status: statusByPath.get(path) ?? inferStatus(chunk),
      additions,
      deletions,
      diff: chunk.trimEnd(),
    };
  });

  if (parsed.length > 0) return parsed;
  return [...statusByPath.entries()].map(([path, status]) => ({
    path,
    status,
    additions: 0,
    deletions: 0,
    diff: '',
  }));
}

function parseDiffPath(chunk: string): string {
  const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  return header?.[2] ?? header?.[1] ?? 'unknown';
}

function inferStatus(chunk: string): string {
  if (/^new file mode /m.test(chunk)) return 'A';
  if (/^deleted file mode /m.test(chunk)) return 'D';
  if (/^rename from /m.test(chunk)) return 'R';
  return 'M';
}
