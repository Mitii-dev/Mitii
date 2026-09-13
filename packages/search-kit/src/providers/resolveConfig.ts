import { z } from 'zod';

import { SearchProviderIdSchema, type FetchImpl, type SearchProvider } from '../types.js';
import { BraveSearchProvider } from './brave.js';
import { SearchProviderChain } from './chain.js';
import { SearxngSearchProvider } from './searxng.js';
import { TavilySearchProvider } from './tavily.js';

export const SearchKitConfigSchema = z.object({
  /** Ordered provider ids. Empty when nothing configured. */
  providers: z.array(SearchProviderIdSchema).max(5).optional(),
  braveApiKey: z.string().optional(),
  tavilyApiKey: z.string().optional(),
  searxngBaseUrl: z.string().optional(),
  searxngCategories: z.string().optional(),
  searxngLanguage: z.string().optional(),
  githubToken: z.string().optional(),
  stackExchangeKey: z.string().optional(),
  /** When true, content resolvers may probe Accept: text/markdown. */
  markdownAcceptProbe: z.boolean().optional(),
  markdownSuffixHosts: z.array(z.string()).optional(),
});
export type SearchKitConfig = z.infer<typeof SearchKitConfigSchema>;

export interface ResolveSearchKitConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Explicit Brave/Mitii search key (e.g. SecretStorage). */
  apiKey?: string;
  /** Override provider order, e.g. "searxng,brave,tavily". */
  providers?: string;
  config?: Partial<SearchKitConfig>;
}

function parseProviderList(raw: string | undefined): SearchKitConfig['providers'] {
  if (!raw?.trim()) return undefined;
  const parts = raw
    .split(/[,+\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const parsed: Array<'brave' | 'searxng' | 'tavily'> = [];
  for (const part of parts) {
    const id = SearchProviderIdSchema.safeParse(part);
    if (id.success && !parsed.includes(id.data)) {
      parsed.push(id.data);
    }
  }
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Resolve config from env + host overrides.
 *
 * Env keys:
 * - MITII_SEARCH_PROVIDERS / SEARCH_PROVIDERS
 * - MITII_SEARCH_API_KEY / BRAVE_API_KEY
 * - TAVILY_API_KEY
 * - SEARXNG_BASE_URL / MITII_SEARXNG_URL
 * - GITHUB_TOKEN
 * - STACKEXCHANGE_KEY
 * - MITII_MARKDOWN_ACCEPT_PROBE=1
 */
export function resolveSearchKitConfig(
  options: ResolveSearchKitConfigOptions = {},
): SearchKitConfig {
  const env = options.env ?? process.env;
  const braveApiKey =
    options.apiKey?.trim() ||
    options.config?.braveApiKey?.trim() ||
    env.MITII_SEARCH_API_KEY?.trim() ||
    env.BRAVE_API_KEY?.trim() ||
    undefined;
  const tavilyApiKey =
    options.config?.tavilyApiKey?.trim() ||
    env.TAVILY_API_KEY?.trim() ||
    undefined;
  const searxngBaseUrl =
    options.config?.searxngBaseUrl?.trim() ||
    env.MITII_SEARXNG_URL?.trim() ||
    env.SEARXNG_BASE_URL?.trim() ||
    undefined;

  const providers =
    options.config?.providers ??
    parseProviderList(options.providers) ??
    parseProviderList(env.MITII_SEARCH_PROVIDERS) ??
    parseProviderList(env.SEARCH_PROVIDERS) ??
    defaultProviderOrder({ braveApiKey, tavilyApiKey, searxngBaseUrl });

  // Normalize empty arrays to undefined so Zod optional accepts "nothing configured".
  const normalizedProviders =
    providers && providers.length > 0 ? providers : undefined;

  const markdownAcceptProbe =
    options.config?.markdownAcceptProbe ??
    env.MITII_MARKDOWN_ACCEPT_PROBE === '1';

  const suffixRaw =
    options.config?.markdownSuffixHosts ??
    (env.MITII_MARKDOWN_SUFFIX_HOSTS
      ? env.MITII_MARKDOWN_SUFFIX_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined);

  return SearchKitConfigSchema.parse({
    providers: normalizedProviders,
    braveApiKey,
    tavilyApiKey,
    searxngBaseUrl,
    searxngCategories:
      options.config?.searxngCategories ?? env.SEARXNG_CATEGORIES?.trim(),
    searxngLanguage:
      options.config?.searxngLanguage ?? env.SEARXNG_LANGUAGE?.trim(),
    githubToken:
      options.config?.githubToken?.trim() || env.GITHUB_TOKEN?.trim() || undefined,
    stackExchangeKey:
      options.config?.stackExchangeKey?.trim() ||
      env.STACKEXCHANGE_KEY?.trim() ||
      undefined,
    markdownAcceptProbe,
    markdownSuffixHosts: suffixRaw,
  });
}

function defaultProviderOrder(keys: {
  braveApiKey?: string;
  tavilyApiKey?: string;
  searxngBaseUrl?: string;
}): Array<'brave' | 'searxng' | 'tavily'> {
  const order: Array<'brave' | 'searxng' | 'tavily'> = [];
  // Local-first: SearXNG before paid APIs when configured.
  if (keys.searxngBaseUrl) order.push('searxng');
  if (keys.braveApiKey) order.push('brave');
  if (keys.tavilyApiKey) order.push('tavily');
  return order;
}

export interface CreateSearchProvidersOptions {
  config: SearchKitConfig;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

/** Build concrete providers that have credentials / base URL. */
export function createSearchProviders(
  options: CreateSearchProvidersOptions,
): SearchProvider[] {
  const { config, fetchImpl, timeoutMs } = options;
  const ids = config.providers ?? defaultProviderOrder(config);
  const providers: SearchProvider[] = [];

  for (const id of ids) {
    if (id === 'searxng' && config.searxngBaseUrl) {
      providers.push(
        new SearxngSearchProvider({
          baseUrl: config.searxngBaseUrl,
          categories: config.searxngCategories,
          language: config.searxngLanguage,
          fetchImpl,
          timeoutMs,
        }),
      );
    } else if (id === 'brave' && config.braveApiKey) {
      providers.push(
        new BraveSearchProvider({
          apiKey: config.braveApiKey,
          fetchImpl,
          timeoutMs,
        }),
      );
    } else if (id === 'tavily' && config.tavilyApiKey) {
      providers.push(
        new TavilySearchProvider({
          apiKey: config.tavilyApiKey,
          fetchImpl,
          timeoutMs,
        }),
      );
    }
  }

  return providers;
}

/**
 * Create a chained SearchProvider, or undefined when nothing is configured.
 * Hosts map this onto V8 `SearchPort`.
 */
export function createOptionalSearchProvider(
  options: ResolveSearchKitConfigOptions & {
    fetchImpl?: FetchImpl;
    timeoutMs?: number;
  } = {},
): SearchProvider | undefined {
  const config = resolveSearchKitConfig(options);
  const providers = createSearchProviders({
    config,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  if (providers.length === 0) return undefined;
  if (providers.length === 1) return providers[0];
  return new SearchProviderChain({ providers });
}
