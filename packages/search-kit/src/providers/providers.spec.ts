import { describe, expect, it, vi } from 'vitest';

import { BraveSearchProvider } from './brave.js';
import { SearchProviderChain } from './chain.js';
import { SearxngSearchProvider } from './searxng.js';
import {
  createOptionalSearchProvider,
  resolveSearchKitConfig,
} from './resolveConfig.js';
import { TavilySearchProvider } from './tavily.js';
import type { SearchProvider, WebSearchRequest, WebSearchResult } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveSearchKitConfig', () => {
  it('prefers SearXNG before Brave when both configured', () => {
    const config = resolveSearchKitConfig({
      env: {
        SEARXNG_BASE_URL: 'http://127.0.0.1:8080',
        BRAVE_API_KEY: 'brave-key',
      },
    });
    expect(config.providers).toEqual(['searxng', 'brave']);
  });

  it('honors MITII_SEARCH_PROVIDERS order', () => {
    const config = resolveSearchKitConfig({
      env: {
        MITII_SEARCH_PROVIDERS: 'tavily,brave',
        TAVILY_API_KEY: 'tvly',
        BRAVE_API_KEY: 'brave',
      },
    });
    expect(config.providers).toEqual(['tavily', 'brave']);
  });

  it('returns undefined provider when nothing configured', () => {
    expect(createOptionalSearchProvider({ env: {} })).toBeUndefined();
  });
});

describe('BraveSearchProvider', () => {
  it('maps Brave JSON to WebSearchResult', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        web: {
          results: [
            {
              title: 'Example',
              url: 'https://example.com/a',
              description: 'Snippet',
              age: '2 days ago',
            },
          ],
        },
      }),
    );
    const provider = new BraveSearchProvider({
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await provider.search({
      query: 'playwright target closed',
      maxResults: 5,
    });
    expect(result.provider).toBe('brave');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.url).toBe('https://example.com/a');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('throws on non-OK status without leaking key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const provider = new BraveSearchProvider({
      apiKey: 'super-secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      provider.search({ query: 'x', maxResults: 3 }),
    ).rejects.toThrow(/Brave search failed/);
  });
});

describe('SearxngSearchProvider', () => {
  it('calls local SearXNG with format=json', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('format=json');
      expect(url).toContain('127.0.0.1');
      return jsonResponse({
        results: [
          {
            title: 'Local',
            url: 'https://docs.example.com',
            content: 'from searx',
          },
        ],
      });
    });
    const provider = new SearxngSearchProvider({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await provider.search({ query: 'zod', maxResults: 5 });
    expect(result.results[0]?.source).toBe('searxng');
  });
});

describe('TavilySearchProvider', () => {
  it('POSTs query and maps results', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.query).toBe('bullmq');
      expect(body.api_key).toBe('tvly-test');
      return jsonResponse({
        results: [
          {
            title: 'BullMQ',
            url: 'https://docs.bullmq.io',
            content: 'queue docs',
          },
        ],
      });
    });
    const provider = new TavilySearchProvider({
      apiKey: 'tvly-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await provider.search({ query: 'bullmq', maxResults: 3 });
    expect(result.results[0]?.title).toBe('BullMQ');
  });
});

describe('SearchProviderChain', () => {
  it('falls through on failure and empty results', async () => {
    const failing: SearchProvider = {
      id: 'brave',
      async search(): Promise<WebSearchResult> {
        throw new Error('upstream down');
      },
    };
    const empty: SearchProvider = {
      id: 'tavily',
      async search(req: WebSearchRequest): Promise<WebSearchResult> {
        return { query: req.query, results: [], truncated: false, provider: 'tavily' };
      },
    };
    const ok: SearchProvider = {
      id: 'searxng',
      async search(req: WebSearchRequest): Promise<WebSearchResult> {
        return {
          query: req.query,
          results: [
            {
              title: 'Hit',
              url: 'https://example.com',
              snippet: 'ok',
              source: 'searxng',
            },
          ],
          truncated: false,
          provider: 'searxng',
        };
      },
    };

    const chain = new SearchProviderChain({
      providers: [failing, empty, ok],
    });
    const result = await chain.search({ query: 'x', maxResults: 5 });
    expect(result.results).toHaveLength(1);
    expect(result.partialFailures?.[0]?.provider).toBe('brave');
  });

  it('throws when every provider fails', async () => {
    const a: SearchProvider = {
      id: 'brave',
      async search() {
        throw new Error('a failed');
      },
    };
    const b: SearchProvider = {
      id: 'tavily',
      async search() {
        throw new Error('b failed');
      },
    };
    const chain = new SearchProviderChain({ providers: [a, b] });
    await expect(chain.search({ query: 'x', maxResults: 1 })).rejects.toThrow(
      /All search providers failed/,
    );
  });
});
