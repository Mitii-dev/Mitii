import { describe, expect, it, vi } from 'vitest';

import { createContentResolverChain } from './resolver.js';
import { parseArxivUrl } from './arxiv.js';
import { parseGitHubIssueUrl } from './githubIssue.js';
import { parseStackExchangeUrl } from './stackexchange.js';
import { parseWikipediaUrl } from './wikipedia.js';
import { stripHtmlToText } from './shared.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('URL parsers', () => {
  it('parses Stack Overflow question URLs', () => {
    expect(
      parseStackExchangeUrl(
        'https://stackoverflow.com/questions/12345/how-to-fix',
      ),
    ).toEqual({ site: 'stackoverflow', questionId: 12345 });
  });

  it('parses GitHub issue URLs', () => {
    expect(
      parseGitHubIssueUrl('https://github.com/acme/widget/issues/42'),
    ).toEqual({ owner: 'acme', repo: 'widget', number: 42 });
  });

  it('parses Wikipedia and arXiv URLs', () => {
    expect(
      parseWikipediaUrl('https://en.wikipedia.org/wiki/Model_Context_Protocol'),
    ).toEqual({ lang: 'en', title: 'Model Context Protocol' });
    expect(parseArxivUrl('https://arxiv.org/abs/1706.03762')).toEqual({
      id: '1706.03762',
    });
  });
});

describe('stripHtmlToText', () => {
  it('removes scripts and collapses whitespace', () => {
    const text = stripHtmlToText(
      '<div>Hello<script>evil()</script><p>world</p></div>',
    );
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).not.toContain('evil');
  });
});

describe('createContentResolverChain', () => {
  it('resolves Stack Overflow via API into Markdown with answers', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/answers')) {
        return jsonResponse({
          items: [
            {
              body: '<p>Use Z</p>',
              score: 42,
              is_accepted: true,
            },
          ],
        });
      }
      if (url.includes('/questions/99')) {
        return jsonResponse({
          items: [
            {
              title: 'How do I fix X?',
              body: '<p>I tried Y</p>',
              score: 10,
              link: 'https://stackoverflow.com/questions/99/how',
            },
          ],
        });
      }
      return jsonResponse({ items: [] }, 404);
    });

    const chain = createContentResolverChain({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      includeHtmlFallback: false,
    });
    const result = await chain.resolve({
      url: 'https://stackoverflow.com/questions/99/how',
    });
    expect(result.resolver).toBe('stackexchange');
    expect(result.body).toContain('How do I fix X?');
    expect(result.body).toContain('Use Z');
    expect(result.body).toContain('accepted');
  });

  it('resolves GitHub issues with comments', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/issues/7') && !url.includes('comments')) {
        return jsonResponse({
          title: 'Crash on start',
          state: 'open',
          body: 'Repro steps',
          html_url: 'https://github.com/acme/app/issues/7',
          user: { login: 'alice' },
          comments_url:
            'https://api.github.com/repos/acme/app/issues/7/comments',
        });
      }
      if (url.includes('comments')) {
        return jsonResponse([
          { user: { login: 'bob' }, body: 'Try upgrading foo' },
        ]);
      }
      return jsonResponse({}, 404);
    });

    const chain = createContentResolverChain({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      includeHtmlFallback: false,
      config: { githubToken: 'ghs_test' },
    });
    const result = await chain.resolve({
      url: 'https://github.com/acme/app/issues/7',
    });
    expect(result.resolver).toBe('github_issue');
    expect(result.body).toContain('Crash on start');
    expect(result.body).toContain('Try upgrading foo');
    expect(result.body).toContain('@bob');
  });

  it('falls back to HTML readability for generic pages', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        '<html><head><title>Docs</title></head><body><article><h1>Install</h1><p>Run npm i pkg</p></article></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    );
    const chain = createContentResolverChain({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await chain.resolve({
      url: 'https://example.com/docs/install',
    });
    expect(result.resolver).toBe('html_readability');
    expect(result.body).toContain('Run npm i pkg');
    expect(result.body).toContain('Source: https://example.com/docs/install');
  });
});
