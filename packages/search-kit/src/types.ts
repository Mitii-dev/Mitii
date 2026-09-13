import { z } from 'zod';

/** Supported first-party search providers (Phase 1). */
export const SearchProviderIdSchema = z.enum(['brave', 'searxng', 'tavily']);
export type SearchProviderId = z.infer<typeof SearchProviderIdSchema>;

export const WebSearchHitSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string(),
  publishedAt: z.string().optional(),
  source: z.string().optional(),
});
export type WebSearchHit = z.infer<typeof WebSearchHitSchema>;

export const WebSearchRequestSchema = z.object({
  query: z.string().min(1).max(2_000),
  maxResults: z.number().int().min(1).max(20).default(5),
  signal: z.any().optional(),
});
export type WebSearchRequest = {
  query: string;
  maxResults: number;
  signal?: AbortSignal;
};

export const WebSearchResultSchema = z.object({
  query: z.string(),
  results: z.array(WebSearchHitSchema),
  truncated: z.boolean(),
  provider: z.string().optional(),
  partialFailures: z
    .array(
      z.object({
        provider: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export interface SearchProvider {
  readonly id: SearchProviderId;
  search(request: WebSearchRequest): Promise<WebSearchResult>;
}

export const ContentResolveRequestSchema = z.object({
  url: z.string().url(),
  signal: z.any().optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(15_000),
  maxBodyBytes: z.number().int().positive().max(5_000_000).default(512_000),
});
export type ContentResolveRequest = {
  url: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBodyBytes?: number;
};

export const ContentResolveResultSchema = z.object({
  url: z.string(),
  status: z.number().int(),
  body: z.string(),
  contentType: z.string().optional(),
  resolver: z.string(),
  truncated: z.boolean(),
});
export type ContentResolveResult = z.infer<typeof ContentResolveResultSchema>;

export interface ContentResolver {
  readonly id: string;
  /** Return true when this resolver should handle the URL. */
  canHandle(url: string): boolean;
  resolve(request: ContentResolveRequest): Promise<ContentResolveResult>;
}

export type FetchImpl = typeof fetch;
