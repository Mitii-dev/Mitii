import type { GitHubIssue, GitHubIssueRef } from '../../../features/ce/github';

export interface TaskSignals {
  githubIssue?: {
    ref: GitHubIssueRef;
    issue?: GitHubIssue;
    fetched: boolean;
    error?: string;
  };
}

export interface EnrichedTask {
  originalMessage: string;
  classificationText: string;
  retrievalText: string;
  contextBlocks: string[];
  signals: TaskSignals;
}
export type MitiiTaskStatus = 'backlog' | 'running' | 'review' | 'done' | 'failed' | 'cancelled';

export interface MitiiTask {
  id: string;
  title: string;
  prompt: string;
  status: MitiiTaskStatus;
  worktreeId?: string;
  sessionId?: string;
  branch?: string;
  dependsOn?: string[];
  createdAt: number;
  updatedAt: number;
  result?: { summary: string; filesChanged: string[] };
  error?: string;
}
