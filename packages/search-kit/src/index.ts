/**
 * @mitii/search-kit — host-neutral web retrieval helpers.
 *
 * Dependency direction:
 *   @mitii/host → @mitii/search-kit
 *   (future MCP) → @mitii/search-kit
 *
 * Must NOT depend on @mitii/v8, @mitii/sdk, @mitii/host, or apps.
 */

export type {
  SearchProviderId,
  WebSearchHit,
  WebSearchRequest,
  WebSearchResult,
  SearchProvider,
  ContentResolveRequest,
  ContentResolveResult,
  ContentResolver,
  FetchImpl,
} from './types.js';
export {
  SearchProviderIdSchema,
  WebSearchHitSchema,
  WebSearchRequestSchema,
  WebSearchResultSchema,
  ContentResolveRequestSchema,
  ContentResolveResultSchema,
} from './types.js';

export {
  UrlSafetyError,
  isPrivateOrLocalHostname,
  assertHttpUrl,
  assertPublicHttpUrl,
} from './safety/urlSafety.js';
export {
  DEFAULT_SEARCH_TIMEOUT_MS,
  DEFAULT_CONTENT_TIMEOUT_MS,
  DEFAULT_MAX_SEARCH_RESULTS,
  DEFAULT_MAX_CONTENT_BYTES,
  DEFAULT_MAX_MARKDOWN_CHARS,
  MAX_PROVIDER_CHAIN,
  MAX_REDIRECTS,
  clampResults,
  truncateText,
} from './safety/limits.js';

export { httpGet, sanitizeErrorMessage } from './http/httpGet.js';
export type { HttpGetOptions, HttpGetResult } from './http/httpGet.js';

export { BraveSearchProvider } from './providers/brave.js';
export type { BraveSearchProviderOptions } from './providers/brave.js';
export { SearxngSearchProvider } from './providers/searxng.js';
export type { SearxngSearchProviderOptions } from './providers/searxng.js';
export { TavilySearchProvider } from './providers/tavily.js';
export type { TavilySearchProviderOptions } from './providers/tavily.js';
export { SearchProviderChain } from './providers/chain.js';
export type { SearchProviderChainOptions } from './providers/chain.js';
export {
  SearchKitConfigSchema,
  resolveSearchKitConfig,
  createSearchProviders,
  createOptionalSearchProvider,
} from './providers/resolveConfig.js';
export type {
  SearchKitConfig,
  ResolveSearchKitConfigOptions,
  CreateSearchProvidersOptions,
} from './providers/resolveConfig.js';

export {
  parseStackExchangeUrl,
  StackExchangeContentResolver,
} from './content/stackexchange.js';
export type { StackExchangeResolverOptions } from './content/stackexchange.js';
export {
  parseGitHubIssueUrl,
  GitHubIssueContentResolver,
} from './content/githubIssue.js';
export type { GitHubIssueResolverOptions } from './content/githubIssue.js';
export {
  parseWikipediaUrl,
  WikipediaContentResolver,
} from './content/wikipedia.js';
export type { WikipediaResolverOptions } from './content/wikipedia.js';
export { parseArxivUrl, ArxivContentResolver } from './content/arxiv.js';
export type { ArxivResolverOptions } from './content/arxiv.js';
export { MarkdownProbeContentResolver } from './content/markdownProbe.js';
export type { MarkdownProbeResolverOptions } from './content/markdownProbe.js';
export { HtmlReadabilityContentResolver } from './content/htmlReadability.js';
export type { HtmlReadabilityResolverOptions } from './content/htmlReadability.js';
export {
  ContentResolverChain,
  createContentResolverChain,
} from './content/resolver.js';
export type {
  ContentResolverChainOptions,
  CreateContentResolverChainOptions,
} from './content/resolver.js';
export {
  stripHtmlToText,
  finishMarkdown,
  normalizeContentRequest,
} from './content/shared.js';
