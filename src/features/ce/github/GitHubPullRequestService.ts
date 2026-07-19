import { execFileSync } from 'child_process';

type FetchLike = typeof fetch;

export interface GitHubPullRequestInput {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
  maintainerCanModify?: boolean;
}

export interface GitHubPullRequestResult {
  number: number;
  htmlUrl: string;
  state: string;
  draft: boolean;
}

export class GitHubPullRequestService {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly userAgent = 'Mitii-AI-Agent'
  ) {}

  async createPullRequest(input: GitHubPullRequestInput, token: string): Promise<GitHubPullRequestResult> {
    if (!token) {
      throw new Error('GitHub token is required to create a pull request');
    }
    const response = await this.fetchImpl(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': this.userAgent,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft ?? true,
        maintainer_can_modify: input.maintainerCanModify ?? true,
      }),
    });
    if (!response.ok) {
      throw new Error(`GitHub PR request failed (${response.status}): ${await safeErrorText(response)}`);
    }
    const body = await response.json() as { number?: number; html_url?: string; state?: string; draft?: boolean };
    return {
      number: body.number ?? 0,
      htmlUrl: body.html_url ?? '',
      state: body.state ?? 'unknown',
      draft: body.draft ?? Boolean(input.draft ?? true),
    };
  }
}

export function parseGitHubRemoteUrl(remote: string): { owner: string; repo: string } | undefined {
  const trimmed = remote.trim().replace(/\.git$/, '');
  const ssh = /^git@github\.com:([^/]+)\/(.+)$/.exec(trimmed);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = /^https:\/\/github\.com\/([^/]+)\/(.+)$/.exec(trimmed);
  if (https) return { owner: https[1], repo: https[2] };
  return undefined;
}

export function inferGitHubRepo(cwd: string): { owner: string; repo: string } | undefined {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf-8' });
    return parseGitHubRemoteUrl(remote);
  } catch {
    return undefined;
  }
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string };
    return body.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
