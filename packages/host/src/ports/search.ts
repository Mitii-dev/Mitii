import type { SearchPort } from '@mitii/v8';
import {
  BraveSearchProvider,
  createOptionalSearchProvider,
  resolveSearchKitConfig,
  type FetchImpl,
  type ResolveSearchKitConfigOptions,
  type SearchKitConfig,
  type SearchProvider,
} from '@mitii/search-kit';

export interface CreateSearchPortOptions {
  /** Overrides env vars when hosts store keys in SecretStorage (Brave/Mitii key). */
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
  /** Comma-separated provider order override, e.g. "searxng,brave". */
  providers?: string;
  /** Partial kit config override. */
  config?: Partial<SearchKitConfig>;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

/**
 * Optional multi-provider SearchPort (SearXNG → Brave → Tavily by default).
 * Returns undefined when no provider credentials/base URL are configured so
 * hosts can omit SearchPort and Decision/Engine hide `web_search`.
 */
export function createOptionalSearchPort(
  envOrOptions: NodeJS.ProcessEnv | CreateSearchPortOptions = process.env,
): SearchPort | undefined {
  const options = normalizeOptions(envOrOptions);
  const provider = createOptionalSearchProvider({
    env: options.env,
    apiKey: options.apiKey,
    providers: options.providers,
    config: options.config,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  if (!provider) return undefined;
  return new SearchKitSearchAdapter(provider);
}

function normalizeOptions(
  envOrOptions: NodeJS.ProcessEnv | CreateSearchPortOptions,
): CreateSearchPortOptions {
  if (
    envOrOptions &&
    typeof envOrOptions === 'object' &&
    ('env' in envOrOptions ||
      'apiKey' in envOrOptions ||
      'providers' in envOrOptions ||
      'config' in envOrOptions ||
      'fetchImpl' in envOrOptions)
  ) {
    return envOrOptions as CreateSearchPortOptions;
  }
  return { env: envOrOptions as NodeJS.ProcessEnv };
}

/**
 * Adapts `@mitii/search-kit` SearchProvider → V8 SearchPort.
 * Kit-only fields (`provider`, `partialFailures`) are omitted from the port
 * result so the V8 tool schema stays stable.
 */
export class SearchKitSearchAdapter implements SearchPort {
  constructor(private readonly provider: SearchProvider) {}

  public async search(request: {
    query: string;
    maxResults: number;
    signal?: AbortSignal;
  }): Promise<{
    query: string;
    results: Array<{
      title: string;
      url: string;
      snippet: string;
      publishedAt?: string;
      source?: string;
    }>;
    truncated: boolean;
  }> {
    const result = await this.provider.search(request);
    return {
      query: result.query,
      results: result.results.map((hit) => ({
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
        ...(hit.source ? { source: hit.source } : {}),
      })),
      truncated: result.truncated,
    };
  }
}

/**
 * @deprecated Prefer SearchKitSearchAdapter. Kept for callers that constructed
 * Brave directly in tests or custom hosts.
 */
export class BraveSearchAdapter implements SearchPort {
  private readonly inner: SearchPort;

  constructor(options: {
    apiKey: string;
    fetchImpl?: FetchImpl;
    baseUrl?: string;
  }) {
    this.inner = new SearchKitSearchAdapter(
      new BraveSearchProvider({
        apiKey: options.apiKey,
        fetchImpl: options.fetchImpl,
        baseUrl: options.baseUrl,
      }),
    );
  }

  public search(request: {
    query: string;
    maxResults: number;
    signal?: AbortSignal;
  }): ReturnType<SearchPort['search']> {
    return this.inner.search(request);
  }
}

export {
  resolveSearchKitConfig,
  type ResolveSearchKitConfigOptions,
  type SearchKitConfig,
};
