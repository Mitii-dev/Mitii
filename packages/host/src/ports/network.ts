import type { NetworkFetchRequest, NetworkFetchResult, NetworkPort } from '@mitii/v8';
import {
  createContentResolverChain,
  resolveSearchKitConfig,
  type ContentResolverChain,
  type FetchImpl,
  type SearchKitConfig,
} from '@mitii/search-kit';

export interface CreateHostNetworkPortOptions {
  /** Underlying HTTP adapter (typically NodeNetworkAdapter). */
  inner: NetworkPort;
  env?: NodeJS.ProcessEnv;
  config?: Partial<SearchKitConfig>;
  fetchImpl?: FetchImpl;
  /**
   * When true (default), try site-aware content resolvers before raw HTTP.
   * Set false to disable enrichment (tests / air-gapped debugging).
   */
  enrichContent?: boolean;
}

/**
 * NetworkPort wrapper that prefers LLM-oriented Markdown from
 * `@mitii/search-kit` content resolvers (Stack Overflow, GitHub issues,
 * Wikipedia, arXiv, markdown probes, HTML readability) before falling back
 * to the inner HTTP adapter.
 *
 * V8 `fetch_url` / `fetch_docs` stay unchanged; richness is host-side only.
 */
export function createHostNetworkPort(
  options: CreateHostNetworkPortOptions,
): NetworkPort {
  if (options.enrichContent === false) {
    return options.inner;
  }
  const kitConfig = resolveSearchKitConfig({
    env: options.env ?? process.env,
    config: options.config,
  });
  const chain = createContentResolverChain({
    config: kitConfig,
    fetchImpl: options.fetchImpl,
    includeHtmlFallback: true,
  });
  return new ContentAwareNetworkAdapter(options.inner, chain);
}

export class ContentAwareNetworkAdapter implements NetworkPort {
  constructor(
    private readonly inner: NetworkPort,
    private readonly chain: ContentResolverChain,
  ) {}

  public async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResult> {
    // HEAD and non-GET stay on the raw adapter.
    if (request.method === 'HEAD') {
      return this.inner.fetch(request);
    }

    try {
      const resolved = await this.chain.resolve({
        url: request.url,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
        maxBodyBytes: request.maxBodyBytes,
      });
      return {
        status: resolved.status,
        headers: {
          'content-type': resolved.contentType ?? 'text/markdown; charset=utf-8',
          'x-mitii-content-resolver': resolved.resolver,
        },
        body: resolved.body,
        truncated: resolved.truncated,
      };
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          (error as NodeJS.ErrnoException).code === 'ETIMEDOUT')
      ) {
        throw error;
      }
      // Resolver chain failed (blocked URL, API error, etc.) → raw fetch.
      return this.inner.fetch(request);
    }
  }
}
