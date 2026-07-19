import {
  GitHubIssueFetcher,
  buildGitHubIssueClassificationText,
  buildGitHubIssueContext,
  buildGitHubIssueReferenceContext,
  parseGitHubIssueUrl,
  type GitHubIssueFetchOptions,
} from '../../../features/ce/github';
import type { EnrichedTask } from './types';

export interface EnrichTaskOptions {
  github?: {
    enabled?: boolean;
    allowNetwork?: boolean;
    tokenProvider?: () => Promise<string | undefined>;
    fetcher?: GitHubIssueFetcher;
    maxComments?: number;
  };
}

export async function enrichTask(message: string, options: EnrichTaskOptions = {}): Promise<EnrichedTask> {
  const contextBlocks: string[] = [];
  const signals: EnrichedTask['signals'] = {};
  let classificationText = message;
  let retrievalText = message;

  const githubRef = parseGitHubIssueUrl(message);
  if (!githubRef || options.github?.enabled === false) {
    return { originalMessage: message, classificationText, retrievalText, contextBlocks, signals };
  }

  if (!options.github?.allowNetwork) {
    const reason = 'network access is disabled by the active safety preset';
    contextBlocks.push(buildGitHubIssueReferenceContext(githubRef, reason));
    signals.githubIssue = { ref: githubRef, fetched: false, error: reason };
    classificationText = `${message}\n\nGitHub issue detected: ${githubRef.owner}/${githubRef.repo}#${githubRef.number}`;
    retrievalText = classificationText;
    return { originalMessage: message, classificationText, retrievalText, contextBlocks, signals };
  }

  try {
    const token = await options.github.tokenProvider?.();
    const fetcher = options.github.fetcher ?? new GitHubIssueFetcher();
    const fetchOptions: GitHubIssueFetchOptions = {
      token,
      maxComments: options.github.maxComments,
    };
    const issue = await fetcher.fetchIssue(githubRef, fetchOptions);
    const issueText = buildGitHubIssueClassificationText(issue);
    contextBlocks.push(buildGitHubIssueContext(issue));
    signals.githubIssue = { ref: githubRef, issue, fetched: true };
    classificationText = `${message}\n\n${issueText}`;
    retrievalText = classificationText;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    contextBlocks.push(buildGitHubIssueReferenceContext(githubRef, reason));
    signals.githubIssue = { ref: githubRef, fetched: false, error: reason };
    classificationText = `${message}\n\nGitHub issue detected: ${githubRef.owner}/${githubRef.repo}#${githubRef.number}`;
    retrievalText = classificationText;
  }

  return { originalMessage: message, classificationText, retrievalText, contextBlocks, signals };
}
