import { clampResults, DEFAULT_SEARCH_TIMEOUT_MS } from '../safety/limits.js';
import { sanitizeErrorMessage } from '../http/httpGet.js';
import { assertPublicHttpUrl } from '../safety/urlSafety.js';
import type {
  FetchImpl,
  SearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '../types.js';

const TAVILY_DEFAULT_URL = 'https://api.tavily.com/search';

export interface TavilySearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export class TavilySearchProvider implements SearchProvider {
  readonly id = 'tavily' as const;

  constructor(private readonly options: TavilySearchProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('TavilySearchProvider requires a non-empty apiKey.');
    }
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const maxResults = clampResults(request.maxResults);
    const endpoint = this.options.baseUrl ?? TAVILY_DEFAULT_URL;
    assertPublicHttpUrl(endpoint, 'Tavily API URL');

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.options.apiKey,
          query: request.query,
          max_results: maxResults,
          include_answer: false,
          search_depth: 'basic',
        }),
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (timedOut) {
          const timeoutError = new Error(
            `Tavily search timed out after ${timeoutMs}ms.`,
          ) as NodeJS.ErrnoException;
          timeoutError.code = 'ETIMEDOUT';
          throw timeoutError;
        }
        throw error;
      });

      if (!response.ok) {
        throw new Error(
          sanitizeErrorMessage(
            `Tavily search failed with HTTP ${response.status}.`,
          ),
        );
      }

      const payload = (await response.json()) as {
        results?: Array<Record<string, unknown>>;
      };
      const raw = payload.results ?? [];
      const results = raw
        .slice(0, maxResults)
        .map((hit) => ({
          title: String(hit.title ?? hit.url ?? 'Result'),
          url: String(hit.url ?? ''),
          snippet: String(hit.content ?? hit.snippet ?? ''),
          ...(typeof hit.published_date === 'string'
            ? { publishedAt: hit.published_date }
            : {}),
          source: 'tavily',
        }))
        .filter((hit) => hit.url.length > 0);

      return {
        query: request.query,
        results,
        truncated: raw.length > results.length,
        provider: this.id,
      };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}
