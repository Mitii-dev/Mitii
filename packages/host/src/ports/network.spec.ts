import { describe, expect, it, vi } from 'vitest';

import type { NetworkPort } from '@mitii/v8';

import { createHostNetworkPort } from './network.js';

describe('createHostNetworkPort', () => {
  it('returns inner unchanged when enrichContent is false', () => {
    const inner: NetworkPort = {
      async fetch() {
        return { status: 200, headers: {}, body: 'raw', truncated: false };
      },
    };
    expect(createHostNetworkPort({ inner, enrichContent: false })).toBe(inner);
  });

  it('prefers Stack Overflow resolver Markdown over raw HTML', async () => {
    const innerFetch = vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html>should not appear</html>',
      truncated: false,
    }));
    const inner: NetworkPort = { fetch: innerFetch };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/answers')) {
        return new Response(
          JSON.stringify({
            items: [{ body: '<p>solution</p>', score: 5, is_accepted: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/questions/1')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                title: 'Q',
                body: '<p>problem</p>',
                score: 1,
                link: 'https://stackoverflow.com/questions/1/q',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const port = createHostNetworkPort({
      inner,
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await port.fetch({
      url: 'https://stackoverflow.com/questions/1/q',
      timeoutMs: 5_000,
      maxBodyBytes: 100_000,
    });

    expect(result.body).toContain('solution');
    expect(result.headers['x-mitii-content-resolver']).toBe('stackexchange');
    expect(innerFetch).not.toHaveBeenCalled();
  });

  it('falls back to inner when resolvers cannot handle the URL safely', async () => {
    const inner: NetworkPort = {
      async fetch() {
        return {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: 'from-inner',
          truncated: false,
        };
      },
    };
    const port = createHostNetworkPort({
      inner,
      env: {},
      // Force resolvers to fail public URL checks for private targets.
    });
    const result = await port.fetch({
      url: 'http://127.0.0.1/secret',
      timeoutMs: 1_000,
      maxBodyBytes: 1_000,
    });
    expect(result.body).toBe('from-inner');
  });
});
