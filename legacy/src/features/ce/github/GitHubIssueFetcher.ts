import type {
  GitHubIssue,
  GitHubIssueComment,
  GitHubIssueFetchOptions,
  GitHubIssueRef,
  GitHubIssueUser,
} from './types';

type FetchLike = typeof fetch;

interface GitHubApiUser {
  login?: string;
  html_url?: string;
}

interface GitHubApiLabel {
  name?: string;
}

interface GitHubApiMilestone {
  title?: string;
}

interface GitHubApiIssue {
  title?: string;
  body?: string | null;
  state?: string;
  html_url?: string;
  labels?: Array<string | GitHubApiLabel>;
  assignees?: GitHubApiUser[];
  milestone?: GitHubApiMilestone | null;
  user?: GitHubApiUser;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  comments?: number;
}

interface GitHubApiComment {
  id?: number;
  body?: string | null;
  user?: GitHubApiUser;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

export class GitHubIssueFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly rateLimitRemaining?: string | null
  ) {
    super(message);
    this.name = 'GitHubIssueFetchError';
  }
}

export class GitHubIssueFetcher {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly userAgent = 'Mitii-AI-Agent'
  ) {}

  async fetchIssue(ref: GitHubIssueRef, options: GitHubIssueFetchOptions = {}): Promise<GitHubIssue> {
    const maxComments = Math.max(0, Math.min(options.maxComments ?? 8, 25));
    const issue = await this.requestJson<GitHubApiIssue>(
      issueApiUrl(ref),
      options,
      'GitHub issue'
    );
    const totalComments = issue.comments ?? 0;
    const comments = maxComments > 0 && totalComments > 0
      ? await this.fetchComments(ref, maxComments, totalComments, options)
      : [];

    return {
      ref,
      title: issue.title ?? `Issue #${ref.number}`,
      body: issue.body ?? '',
      state: issue.state ?? 'unknown',
      htmlUrl: issue.html_url ?? ref.url,
      labels: normalizeLabels(issue.labels ?? []),
      assignees: (issue.assignees ?? []).map(normalizeUser).filter(Boolean) as GitHubIssueUser[],
      milestone: issue.milestone?.title,
      author: normalizeUser(issue.user),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at ?? undefined,
      comments,
      totalComments,
    };
  }

  private async fetchComments(
    ref: GitHubIssueRef,
    maxComments: number,
    totalComments: number,
    options: GitHubIssueFetchOptions
  ): Promise<GitHubIssueComment[]> {
    const perPage = 100;
    const page = Math.max(1, Math.ceil(totalComments / perPage));
    const latestPage = await this.requestJson<GitHubApiComment[]>(
      commentsApiUrl(ref, perPage, page),
      options,
      'GitHub issue comments'
    );
    const comments = latestPage.length < maxComments && page > 1
      ? [
          ...await this.requestJson<GitHubApiComment[]>(
            commentsApiUrl(ref, perPage, page - 1),
            options,
            'GitHub issue comments'
          ),
          ...latestPage,
        ]
      : latestPage;
    return comments
      .slice(-maxComments)
      .reverse()
      .map((comment) => ({
        id: comment.id ?? 0,
        body: comment.body ?? '',
        author: normalizeUser(comment.user),
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        htmlUrl: comment.html_url,
      }));
  }

  private async requestJson<T>(
    url: string,
    options: GitHubIssueFetchOptions,
    label: string
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': this.userAgent,
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = await safeErrorText(response);
        throw new GitHubIssueFetchError(
          `${label} request failed (${response.status}): ${message}`,
          response.status,
          response.headers.get('x-ratelimit-remaining')
        );
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof GitHubIssueFetchError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GitHubIssueFetchError(`${label} request timed out`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubIssueFetchError(`${label} request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function issueApiUrl(ref: GitHubIssueRef): string {
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
}

function commentsApiUrl(ref: GitHubIssueRef, perPage: number, page: number): string {
  return `${issueApiUrl(ref)}/comments?per_page=${perPage}&page=${page}`;
}

function normalizeUser(user: GitHubApiUser | undefined): GitHubIssueUser | undefined {
  if (!user?.login) return undefined;
  return {
    login: user.login,
    htmlUrl: user.html_url,
  };
}

function normalizeLabels(labels: Array<string | GitHubApiLabel>): string[] {
  return labels
    .map((label) => typeof label === 'string' ? label : label.name)
    .filter((label): label is string => Boolean(label));
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string };
    return body.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
