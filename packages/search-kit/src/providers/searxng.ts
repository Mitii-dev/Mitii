import { clampResults, DEFAULT_SEARCH_TIMEOUT_MS } from '../safety/limits.js';
import { httpGet, sanitizeErrorMessage } from '../http/httpGet.js';
import type {
  FetchImpl,
  SearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '../types.js';

export interface SearxngSearchProviderOptions {
  /** Base URL of a SearXNG instance, e.g. http://127.0.0.1:8080 */
  baseUrl: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  /** Optional SearXNG categories, e.g. "general" */
  categories?: string;
  language?: string;
}

/**
 * Self-hosted / free search via SearXNG JSON API.
 * Localhost and private hosts are allowed for the configured base URL only.
 */
export class SearxngSearchProvider implements SearchProvider {
  readonly id = 'searxng' as const;
  private readonly baseUrl: string;

  constructor(private readonly options: SearxngSearchProviderOptions) {
    const trimmed = options.baseUrl.trim().replace(/\/+$/, '');
    if (!trimmed) {
      throw new Error('SearxngSearchProvider requires a non-empty baseUrl.');
    }
    this.baseUrl = trimmed;
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const maxResults = clampResults(request.maxResults);
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', request.query);
    url.searchParams.set('format', 'json');
    if (this.options.categories) {
      url.searchParams.set('categories', this.options.categories);
    }
    if (this.options.language) {
      url.searchParams.set('language', this.options.language);
    }

    const response = await httpGet({
      url: url.toString(),
      headers: { Accept: 'application/json' },
      timeoutMs: this.options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
      maxBodyBytes: 1_500_000,
      signal: request.signal,
      allowPrivate: true,
      fetchImpl: this.options.fetchImpl,
      label: 'SearXNG URL',
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        sanitizeErrorMessage(
          `SearXNG search failed with HTTP ${response.status}.`,
        ),
      );
    }

    let payload: {
      results?: Array<Record<string, unknown>>;
    };
    try {
      payload = JSON.parse(response.body) as typeof payload;
    } catch {
      throw new Error('SearXNG returned invalid JSON.');
    }

    const raw = payload.results ?? [];
    const results = raw
      .slice(0, maxResults)
      .map((hit) => ({
        title: String(hit.title ?? hit.url ?? 'Result'),
        url: String(hit.url ?? hit.pretty_url ?? ''),
        snippet: String(hit.content ?? hit.snippet ?? ''),
        ...(typeof hit.publishedDate === 'string'
          ? { publishedAt: hit.publishedDate }
          : {}),
        source: 'searxng',
      }))
      .filter((hit) => {
        try {
          new URL(hit.url);
          return hit.url.length > 0;
        } catch {
          return false;
        }
      });

    return {
      query: request.query,
      results,
      truncated: raw.length > results.length,
      provider: this.id,
    };
  }
}
