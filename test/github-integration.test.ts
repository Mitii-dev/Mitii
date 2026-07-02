import { describe, expect, it } from 'vitest';
import {
  GitHubIssueFetcher,
  buildGitHubIssueContext,
  parseGitHubIssueUrl,
} from '../src/core/integrations/github';
import { enrichTask } from '../src/core/task';

describe('GitHub issue integration', () => {
  it('parses GitHub issue URLs without matching pull requests', () => {
    expect(parseGitHubIssueUrl('Fix https://github.com/owner/repo/issues/123 please')).toEqual({
      owner: 'owner',
      repo: 'repo',
      number: 123,
      url: 'https://github.com/owner/repo/issues/123',
    });
    expect(parseGitHubIssueUrl('github.com/acme/my.repo/issues/42?foo=bar')?.number).toBe(42);
    expect(parseGitHubIssueUrl('https://github.com/owner/repo/pull/123')).toBeUndefined();
    expect(parseGitHubIssueUrl('https://notgithub.com/owner/repo/issues/123')).toBeUndefined();
  });

  it('fetches issues and includes newest comments first', async () => {
    const calls: string[] = [];
    const fetcher = new GitHubIssueFetcher(async (url, init) => {
      calls.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ghp_secret');
      if (String(url).endsWith('/comments?per_page=100&page=1')) {
        return jsonResponse([
          { id: 1, body: 'older clue', user: { login: 'alice' }, updated_at: '2026-01-01T00:00:00Z' },
          { id: 2, body: 'newer clue', user: { login: 'bob' }, updated_at: '2026-01-02T00:00:00Z' },
        ]);
      }
      return jsonResponse({
        title: 'Crash on save',
        body: 'Steps to reproduce in src/save.ts',
        state: 'open',
        html_url: 'https://github.com/acme/app/issues/7',
        labels: [{ name: 'bug' }, 'priority'],
        assignees: [{ login: 'dev' }],
        user: { login: 'reporter' },
        comments: 2,
      });
    }) as GitHubIssueFetcher;

    const issue = await fetcher.fetchIssue(
      { owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' },
      { token: 'ghp_secret', maxComments: 2 }
    );

    expect(calls).toEqual([
      'https://api.github.com/repos/acme/app/issues/7',
      'https://api.github.com/repos/acme/app/issues/7/comments?per_page=100&page=1',
    ]);
    expect(issue.title).toBe('Crash on save');
    expect(issue.labels).toEqual(['bug', 'priority']);
    expect(issue.comments.map((comment) => comment.body)).toEqual(['newer clue', 'older clue']);
  });

  it('fetches the newest comments for busy issues', async () => {
    const calls: string[] = [];
    const fetcher = new GitHubIssueFetcher(async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/comments?per_page=100&page=2')) {
        return jsonResponse([
          { id: 101, body: 'recent clue', updated_at: '2026-01-03T00:00:00Z' },
          { id: 102, body: 'newest clue', updated_at: '2026-01-04T00:00:00Z' },
        ]);
      }
      if (String(url).endsWith('/comments?per_page=100&page=1')) {
        return jsonResponse([
          { id: 95, body: 'older 95', updated_at: '2026-01-01T00:00:00Z' },
          { id: 96, body: 'older 96', updated_at: '2026-01-01T00:00:00Z' },
          { id: 97, body: 'older 97', updated_at: '2026-01-01T00:00:00Z' },
          { id: 98, body: 'older 98', updated_at: '2026-01-01T00:00:00Z' },
          { id: 99, body: 'older 99', updated_at: '2026-01-01T00:00:00Z' },
          { id: 100, body: 'older 100', updated_at: '2026-01-01T00:00:00Z' },
        ]);
      }
      return jsonResponse({
        title: 'Busy issue',
        body: '',
        state: 'open',
        html_url: 'https://github.com/acme/app/issues/8',
        comments: 102,
      });
    });

    const issue = await fetcher.fetchIssue(
      { owner: 'acme', repo: 'app', number: 8, url: 'https://github.com/acme/app/issues/8' },
      { maxComments: 8 }
    );

    expect(calls).toEqual([
      'https://api.github.com/repos/acme/app/issues/8',
      'https://api.github.com/repos/acme/app/issues/8/comments?per_page=100&page=2',
      'https://api.github.com/repos/acme/app/issues/8/comments?per_page=100&page=1',
    ]);
    expect(issue.comments.map((comment) => comment.body)).toEqual([
      'newest clue',
      'recent clue',
      'older 100',
      'older 99',
      'older 98',
      'older 97',
      'older 96',
      'older 95',
    ]);
    expect(issue.totalComments).toBe(102);
  });

  it('builds bounded issue context for prompts', () => {
    const context = buildGitHubIssueContext({
      ref: { owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' },
      title: 'Crash on save',
      body: 'A'.repeat(20),
      state: 'open',
      htmlUrl: 'https://github.com/acme/app/issues/7',
      labels: ['bug'],
      assignees: [],
      comments: [
        { id: 1, body: 'B'.repeat(20), author: { login: 'alice' }, updatedAt: '2026-01-01T00:00:00Z' },
      ],
      totalComments: 1,
    }, { maxBodyChars: 8, maxCommentChars: 6 });

    expect(context).toContain('<github_issue_context>');
    expect(context).toContain('Repository: acme/app');
    expect(context).toContain('Title: Crash on save');
    expect(context).toContain('[truncated]');
    expect(context).toContain('Recent comments, newest first');
  });

  it('enriches tasks with issue context when network is allowed', async () => {
    const fetcher = new GitHubIssueFetcher(async () => jsonResponse({
      title: 'Crash on save',
      body: 'Stack trace points at src/save.ts',
      state: 'open',
      html_url: 'https://github.com/acme/app/issues/7',
      labels: [{ name: 'bug' }],
      assignees: [],
      comments: 0,
    }));

    const enriched = await enrichTask('Fix https://github.com/acme/app/issues/7', {
      github: { allowNetwork: true, fetcher },
    });

    expect(enriched.signals.githubIssue?.fetched).toBe(true);
    expect(enriched.classificationText).toContain('Crash on save');
    expect(enriched.retrievalText).toContain('src/save.ts');
    expect(enriched.contextBlocks[0]).toContain('<github_issue_context>');
  });

  it('falls back to a reference block when network is disabled', async () => {
    const enriched = await enrichTask('Fix https://github.com/acme/app/issues/7', {
      github: { allowNetwork: false },
    });

    expect(enriched.signals.githubIssue).toMatchObject({
      fetched: false,
      error: 'network access is disabled by the active safety preset',
    });
    expect(enriched.contextBlocks[0]).toContain('Fetch status: network access is disabled');
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
  } as Response;
}
