export interface WebSearchRequest {
  query: string;
  maxResults: number;
  signal?: AbortSignal;
}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchHit[];
  truncated: boolean;
}

/**
 * Host-injected search provider. V8 does not hardcode a search vendor.
 */
export interface SearchPort {
  search(request: WebSearchRequest): Promise<WebSearchResult>;
}
