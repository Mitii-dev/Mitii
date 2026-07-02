import type { GitHubIssue, GitHubIssueRef } from './types';

export interface GitHubIssueContextOptions {
  maxBodyChars?: number;
  maxCommentChars?: number;
}

export function buildGitHubIssueContext(
  issue: GitHubIssue,
  options: GitHubIssueContextOptions = {}
): string {
  const maxBodyChars = options.maxBodyChars ?? 8_000;
  const maxCommentChars = options.maxCommentChars ?? 1_500;
  const lines = [
    '<github_issue_context>',
    `Repository: ${issue.ref.owner}/${issue.ref.repo}`,
    `Issue: #${issue.ref.number}`,
    `URL: ${issue.htmlUrl}`,
    `State: ${issue.state}`,
    `Title: ${issue.title}`,
    `Author: ${issue.author?.login ?? 'unknown'}`,
    `Labels: ${issue.labels.length ? issue.labels.join(', ') : 'none'}`,
    `Assignees: ${issue.assignees.length ? issue.assignees.map((user) => user.login).join(', ') : 'none'}`,
    `Milestone: ${issue.milestone ?? 'none'}`,
    `Created: ${issue.createdAt ?? 'unknown'}`,
    `Updated: ${issue.updatedAt ?? 'unknown'}`,
    '',
    'Instructions:',
    '- Treat this GitHub issue as user-provided task context.',
    '- Search the open workspace for mentioned files, errors, APIs, and reproduction clues before editing.',
    '- Keep the fix scoped to the issue and verify with relevant tests or configured commands.',
    '',
    'Body:',
    truncate(issue.body.trim() || '(empty)', maxBodyChars),
  ];

  if (issue.comments.length > 0) {
    lines.push(
      '',
      `Recent comments, newest first (${issue.comments.length}/${issue.totalComments} included):`
    );
    for (const comment of issue.comments) {
      lines.push(
        '',
        `- ${comment.author?.login ?? 'unknown'} at ${comment.updatedAt ?? comment.createdAt ?? 'unknown'}:`,
        indent(truncate(comment.body.trim() || '(empty)', maxCommentChars))
      );
    }
  } else {
    lines.push('', `Comments: none (${issue.totalComments} total)`);
  }

  lines.push('</github_issue_context>');
  return lines.join('\n');
}

export function buildGitHubIssueReferenceContext(ref: GitHubIssueRef, reason: string): string {
  return [
    '<github_issue_context>',
    `Repository: ${ref.owner}/${ref.repo}`,
    `Issue: #${ref.number}`,
    `URL: ${ref.url}`,
    `Fetch status: ${reason}`,
    '',
    'Instructions:',
    '- The user referenced this GitHub issue, but full issue details are not available.',
    '- Use the URL, repository, issue number, workspace context, and the user request to decide the next best step.',
    '</github_issue_context>',
  ].join('\n');
}

export function buildGitHubIssueClassificationText(issue: GitHubIssue): string {
  const comments = issue.comments
    .slice(0, 3)
    .map((comment) => comment.body)
    .join('\n\n');
  return [
    `GitHub issue ${issue.ref.owner}/${issue.ref.repo}#${issue.ref.number}: ${issue.title}`,
    `State: ${issue.state}`,
    `Labels: ${issue.labels.join(', ') || 'none'}`,
    issue.body,
    comments,
  ].filter(Boolean).join('\n\n');
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

function indent(text: string): string {
  return text.split('\n').map((line) => `  ${line}`).join('\n');
}
