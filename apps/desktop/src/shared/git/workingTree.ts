/**
 * Desktop Agent Working Tree contract (mitii-desktop/v1 git surface).
 * Porcelain parsing is owned by @mitii/sdk (V8 shared git helpers).
 */

import {
  GIT_PORCELAIN_MAX_FILES,
  flattenPorcelainFiles,
  parseAheadBehind,
  parseGitPorcelain,
  parsePorcelainWorkingTree,
} from '@mitii/sdk';
import type { GitPorcelainFile, GitPorcelainParseResult } from '@mitii/sdk';

export type GitChangeGroup = 'staged' | 'changes' | 'untracked';

export type GitWorkingTreeFile = GitPorcelainFile;

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

export const GIT_WORKING_TREE_MAX_FILES = GIT_PORCELAIN_MAX_FILES;

export { parseAheadBehind, parsePorcelainWorkingTree, parseGitPorcelain };

export function flattenWorkingTreeFiles(
  snapshot: Pick<
    GitPorcelainParseResult,
    'staged' | 'changes' | 'untracked'
  >,
): GitWorkingTreeFile[] {
  return flattenPorcelainFiles(snapshot, GIT_WORKING_TREE_MAX_FILES);
}
