import { MAX_PROVIDER_CHAIN } from '../safety/limits.js';
import { sanitizeErrorMessage } from '../http/httpGet.js';
import type {
  SearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '../types.js';

export interface SearchProviderChainOptions {
  providers: readonly SearchProvider[];
}

/**
 * Ordered fallback across search providers.
 * First successful non-empty result wins. Empty success falls through.
 * All failures are collected into `partialFailures`.
 */
export class SearchProviderChain implements SearchProvider {
  readonly id: SearchProvider['id'];
  private readonly providers: readonly SearchProvider[];

  constructor(options: SearchProviderChainOptions) {
    if (!options.providers.length) {
      throw new Error('SearchProviderChain requires at least one provider.');
    }
    if (options.providers.length > MAX_PROVIDER_CHAIN) {
      throw new Error(
        `SearchProviderChain supports at most ${MAX_PROVIDER_CHAIN} providers.`,
      );
    }
    this.providers = options.providers;
    this.id = options.providers[0]!.id;
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const partialFailures: Array<{ provider: string; message: string }> = [];
    let lastEmpty: WebSearchResult | undefined;

    for (const provider of this.providers) {
      try {
        const result = await provider.search(request);
        if (result.results.length > 0) {
          return {
            ...result,
            partialFailures:
              partialFailures.length > 0 ? partialFailures : undefined,
          };
        }
        lastEmpty = result;
      } catch (error) {
        partialFailures.push({
          provider: provider.id,
          message: sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
    }

    if (lastEmpty) {
      return {
        ...lastEmpty,
        partialFailures:
          partialFailures.length > 0 ? partialFailures : undefined,
      };
    }

    const detail = partialFailures
      .map((f) => `${f.provider}: ${f.message}`)
      .join('; ');
    throw new Error(
      sanitizeErrorMessage(
        `All search providers failed${detail ? ` (${detail})` : '.'}`,
      ),
    );
  }
}
