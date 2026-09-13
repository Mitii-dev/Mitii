import { httpGet } from '../http/httpGet.js';
import type {
  ContentResolveRequest,
  ContentResolver,
  ContentResolveResult,
  FetchImpl,
} from '../types.js';
import { finishMarkdown, normalizeContentRequest } from './shared.js';

export interface GitHubIssueResolverOptions {
  token?: string;
  fetchImpl?: FetchImpl;
}

const ISSUE_RE =
  /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\/|$|\?|#)/i;

export function parseGitHubIssueUrl(
  url: string,
): { owner: string; repo: string; number: number } | undefined {
  const match = ISSUE_RE.exec(url.trim());
  if (!match) return undefined;
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
  };
}

/** GitHub Issues → Markdown via REST API (optional token for rate limits). */
export class GitHubIssueContentResolver implements ContentResolver {
  readonly id = 'github_issue';

  constructor(private readonly options: GitHubIssueResolverOptions = {}) {}

  canHandle(url: string): boolean {
    return parseGitHubIssueUrl(url) !== undefined;
  }

  async resolve(request: ContentResolveRequest): Promise<ContentResolveResult> {
    const req = normalizeContentRequest(request);
    const target = parseGitHubIssueUrl(req.url);
    if (!target) throw new Error('Not a GitHub issue URL.');

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mitii-search-kit',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.options.token) {
      headers.Authorization = `Bearer ${this.options.token}`;
    }

    const issueUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/issues/${target.number}`;
    const issueRes = await httpGet({
      url: issueUrl,
      headers,
      timeoutMs: req.timeoutMs,
      maxBodyBytes: req.maxBodyBytes,
      signal: req.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'GitHub issue API',
    });
    if (issueRes.status < 200 || issueRes.status >= 300) {
      throw new Error(`GitHub issue API HTTP ${issueRes.status}`);
    }

    const issue = JSON.parse(issueRes.body) as Record<string, unknown>;
    const commentsUrl = String(
      issue.comments_url ??
        `https://api.github.com/repos/${target.owner}/${target.repo}/issues/${target.number}/comments`,
    );

    const commentsRes = await httpGet({
      url: `${commentsUrl}?per_page=20`,
      headers,
      timeoutMs: req.timeoutMs,
      maxBodyBytes: req.maxBodyBytes,
      signal: req.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'GitHub comments API',
    });

    const comments =
      commentsRes.status >= 200 && commentsRes.status < 300
        ? (JSON.parse(commentsRes.body) as Array<Record<string, unknown>>)
        : [];

    const title = String(issue.title ?? `Issue #${target.number}`);
    const state = String(issue.state ?? 'unknown');
    const author =
      typeof issue.user === 'object' && issue.user
        ? String((issue.user as { login?: string }).login ?? 'unknown')
        : 'unknown';
    const body = String(issue.body ?? '').trim() || '_No description._';
    const htmlUrl = String(issue.html_url ?? req.url);

    const lines: string[] = [
      `# ${title}`,
      '',
      `Source: ${htmlUrl}`,
      `State: ${state} · Author: @${author} · ${target.owner}/${target.repo}#${target.number}`,
      '',
      '## Issue',
      '',
      body,
      '',
      '## Comments',
      '',
    ];

    if (comments.length === 0) {
      lines.push('_No comments._', '');
    } else {
      for (const comment of comments) {
        const cAuthor =
          typeof comment.user === 'object' && comment.user
            ? String((comment.user as { login?: string }).login ?? 'unknown')
            : 'unknown';
        const cBody = String(comment.body ?? '').trim();
        lines.push(`### @${cAuthor}`, '', cBody || '_Empty comment._', '');
      }
    }

    return finishMarkdown({
      url: req.url,
      status: 200,
      body: lines.join('\n'),
      resolver: this.id,
    });
  }
}
