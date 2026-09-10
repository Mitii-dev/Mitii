import { clampResults, DEFAULT_SEARCH_TIMEOUT_MS } from '../safety/limits.js';
import { httpGet, sanitizeErrorMessage } from '../http/httpGet.js';
import type {
  FetchImpl,
  SearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '../types.js';

const BRAVE_DEFAULT_BASE =
  'https://api.search.brave.com/res/v1/web/search';

export interface BraveSearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export class BraveSearchProvider implements SearchProvider {
  readonly id = 'brave' as const;

  constructor(private readonly options: BraveSearchProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('BraveSearchProvider requires a non-empty apiKey.');
    }
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const maxResults = clampResults(request.maxResults);
    const url = new URL(this.options.baseUrl ?? BRAVE_DEFAULT_BASE);
    url.searchParams.set('q', request.query);
    url.searchParams.set('count', String(Math.min(20, maxResults)));

    const response = await httpGet({
      url: url.toString(),
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.options.apiKey,
      },
      timeoutMs: this.options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
      maxBodyBytes: 1_000_000,
      signal: request.signal,
      fetchImpl: this.options.fetchImpl,
      label: 'Brave Search URL',
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        sanitizeErrorMessage(
          `Brave search failed with HTTP ${response.status}.`,
        ),
      );
    }

    let payload: { web?: { results?: Array<Record<string, unknown>> } };
    try {
      payload = JSON.parse(response.body) as typeof payload;
    } catch {
      throw new Error('Brave search returned invalid JSON.');
    }

    const raw = payload.web?.results ?? [];
    const results = raw
      .slice(0, maxResults)
      .map((hit) => ({
        title: String(hit.title ?? hit.url ?? 'Result'),
        url: String(hit.url ?? ''),
        snippet: String(hit.description ?? hit.snippet ?? ''),
        ...(typeof hit.age === 'string' ? { publishedAt: hit.age } : {}),
        source: 'brave',
      }))
      .filter((hit) => hit.url.length > 0);

    return {
      query: request.query,
      results,
      truncated: raw.length > results.length,
      provider: this.id,
    };
  }
}
