import type { GitWorkingTreeSnapshot } from '../../shared/git/workingTree.js';
import type { ReviewFinding } from '../../shared/reviewFindings.js';

export type ScmGroupKey = 'staged' | 'changes';

export type ScmJob =
  | 'commit-message'
  | 'changelog'
  | 'release-notes'
  | 'pr-summary'
  | 'code-review';

export const JOB_LABEL: Record<ScmJob, string> = {
  'commit-message': 'Commit message',
  changelog: 'Changelog',
  'release-notes': 'Release notes',
  'pr-summary': 'PR summary',
  'code-review': 'Code Review',
};

export type ContextMenuState = {
  x: number;
  y: number;
  paths: string[];
};

export interface ScmAuth {
  baseUrl: string;
  token?: string;
}

export interface GitWorkingTreePaneProps {
  baseUrl: string;
  token?: string;
  activePath: string | null;
  /** Increment to force an immediate status reload (agent / FS changes). */
  refreshToken?: number;
  onOpenDiff: (path: string) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
  onGitCountChange?: (count: number) => void;
  onStatusSnapshot?: (status: GitWorkingTreeSnapshot) => void;
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
  onStatusNote?: (note: string | null) => void;
  onError?: (error: string | null) => void;
  /** After discard — close stale diff tabs / reload open files. */
  onPathsDiscarded?: (paths: readonly string[]) => void;
  /** Bubble Code Review findings to the chat composer strip. */
  onFindingsChange?: (findings: ReviewFinding[]) => void;
  /** When false, hide Code Review button + findings pane (settings). */
  showCodeReview?: boolean;
}
