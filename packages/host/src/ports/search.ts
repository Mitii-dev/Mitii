import type { SearchPort } from '@mitii/v8';

interface WebSearchRequest {
  query: string;
  maxResults: number;
  signal?: AbortSignal;
}

interface WebSearchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
    source?: string;
  }>;
  truncated: boolean;
}

/**
 * Optional Brave Search adapter. Returns undefined when no API key is set so
 * hosts can omit SearchPort and Decision/Engine hide `web_search`.
 */
export function createOptionalSearchPort(
  env: NodeJS.ProcessEnv = process.env,
): SearchPort | undefined {
  const apiKey =
    env.MITII_SEARCH_API_KEY?.trim() ||
    env.BRAVE_API_KEY?.trim() ||
    undefined;
  if (!apiKey) {
    return undefined;
  }
  return new BraveSearchAdapter({ apiKey });
}

export class BraveSearchAdapter implements SearchPort {
  constructor(
    private readonly options: {
      apiKey: string;
      fetchImpl?: typeof fetch;
      baseUrl?: string;
    },
  ) {}

  public async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const baseUrl =
      this.options.baseUrl ?? 'https://api.search.brave.com/res/v1/web/search';
    const url = new URL(baseUrl);
    url.searchParams.set('q', request.query);
    url.searchParams.set('count', String(Math.min(20, Math.max(1, request.maxResults))));

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.options.apiKey,
      },
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Brave search failed with HTTP ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as {
      web?: { results?: Array<Record<string, unknown>> };
    };
    const raw = payload.web?.results ?? [];
    const results = raw.slice(0, request.maxResults).map((hit) => ({
      title: String(hit.title ?? hit.url ?? 'Result'),
      url: String(hit.url ?? ''),
      snippet: String(hit.description ?? hit.snippet ?? ''),
      ...(typeof hit.age === 'string' ? { publishedAt: hit.age } : {}),
      source: 'brave',
    })).filter((hit) => hit.url.length > 0);

    return {
      query: request.query,
      results,
      truncated: raw.length > results.length,
    };
  }
}
