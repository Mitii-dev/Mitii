import type { GitHubIssueRef } from './types';

const ISSUE_URL_RE =
  /(?<![A-Za-z0-9.-])(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9]\d*)(?=$|[/?#\s)\].,;:!])/i;

export function parseGitHubIssueUrl(text: string): GitHubIssueRef | undefined {
  const match = ISSUE_URL_RE.exec(text);
  if (!match) return undefined;

  const [, owner, repo, rawNumber] = match;
  const number = Number(rawNumber);
  if (!Number.isSafeInteger(number) || number <= 0) return undefined;

  return {
    owner,
    repo,
    number,
    url: `https://github.com/${owner}/${repo}/issues/${number}`,
  };
}

export function hasGitHubIssueUrl(text: string): boolean {
  return Boolean(parseGitHubIssueUrl(text));
}
