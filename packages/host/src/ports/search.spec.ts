import { describe, expect, it, vi } from 'vitest';

import { createOptionalSearchPort } from './search.js';

describe('createOptionalSearchPort', () => {
  it('returns undefined when no API key or SearXNG URL is available', () => {
    expect(createOptionalSearchPort({ env: {} })).toBeUndefined();
  });

  it('uses BRAVE_API_KEY from env', () => {
    expect(
      createOptionalSearchPort({ env: { BRAVE_API_KEY: 'test-key' } }),
    ).toBeDefined();
  });

  it('prefers explicit apiKey override over env', () => {
    expect(
      createOptionalSearchPort({
        env: {},
        apiKey: 'override-key',
      }),
    ).toBeDefined();
  });

  it('enables SearchPort from SearXNG alone (no API key)', () => {
    expect(
      createOptionalSearchPort({
        env: { SEARXNG_BASE_URL: 'http://127.0.0.1:8080' },
      }),
    ).toBeDefined();
  });

  it('searches via injected fetchImpl', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Hit',
                url: 'https://example.com',
                description: 'Snippet',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const port = createOptionalSearchPort({
      env: { BRAVE_API_KEY: 'k' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(port).toBeDefined();
    const result = await port!.search({ query: 'test', maxResults: 3 });
    expect(result.results[0]?.url).toBe('https://example.com');
  });
});
