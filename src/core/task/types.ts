import type { GitHubIssue, GitHubIssueRef } from '../integrations/github';

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
