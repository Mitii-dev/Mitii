import type {
  ContentResolveRequest,
  ContentResolver,
  ContentResolveResult,
  FetchImpl,
} from '../types.js';
import { ArxivContentResolver } from './arxiv.js';
import { GitHubIssueContentResolver } from './githubIssue.js';
import { HtmlReadabilityContentResolver } from './htmlReadability.js';
import { MarkdownProbeContentResolver } from './markdownProbe.js';
import { StackExchangeContentResolver } from './stackexchange.js';
import { WikipediaContentResolver } from './wikipedia.js';
import type { SearchKitConfig } from '../providers/resolveConfig.js';
import { sanitizeErrorMessage } from '../http/httpGet.js';

export interface ContentResolverChainOptions {
  resolvers: readonly ContentResolver[];
}

/**
 * Ordered content resolution. First successful `canHandle` + resolve wins.
 * Failed handlers fall through to the next matching resolver.
 */
export class ContentResolverChain {
  constructor(private readonly options: ContentResolverChainOptions) {
    if (!options.resolvers.length) {
      throw new Error('ContentResolverChain requires at least one resolver.');
    }
  }

  async resolve(
    request: ContentResolveRequest,
  ): Promise<ContentResolveResult> {
    const failures: string[] = [];
    for (const resolver of this.options.resolvers) {
      if (!resolver.canHandle(request.url)) continue;
      try {
        return await resolver.resolve(request);
      } catch (error) {
        failures.push(
          `${resolver.id}: ${sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      }
    }
    throw new Error(
      sanitizeErrorMessage(
        `No content resolver succeeded for URL${
          failures.length ? ` (${failures.join('; ')})` : '.'
        }`,
      ),
    );
  }
}

export interface CreateContentResolverChainOptions {
  config?: Pick<
    SearchKitConfig,
    | 'githubToken'
    | 'stackExchangeKey'
    | 'markdownAcceptProbe'
    | 'markdownSuffixHosts'
  >;
  fetchImpl?: FetchImpl;
  /** Include generic HTML fallback (default true). */
  includeHtmlFallback?: boolean;
}

/** Default enterprise resolver order for coding-agent retrieval. */
export function createContentResolverChain(
  options: CreateContentResolverChainOptions = {},
): ContentResolverChain {
  const fetchImpl = options.fetchImpl;
  const config = options.config ?? {};
  const resolvers: ContentResolver[] = [
    new StackExchangeContentResolver({
      apiKey: config.stackExchangeKey,
      fetchImpl,
    }),
    new GitHubIssueContentResolver({
      token: config.githubToken,
      fetchImpl,
    }),
    new WikipediaContentResolver({ fetchImpl }),
    new ArxivContentResolver({ fetchImpl }),
    new MarkdownProbeContentResolver({
      fetchImpl,
      acceptProbe: config.markdownAcceptProbe === true,
      suffixHosts: config.markdownSuffixHosts,
    }),
  ];

  if (options.includeHtmlFallback !== false) {
    resolvers.push(new HtmlReadabilityContentResolver({ fetchImpl }));
  }

  return new ContentResolverChain({ resolvers });
}
