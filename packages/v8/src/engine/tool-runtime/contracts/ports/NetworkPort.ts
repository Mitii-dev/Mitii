export interface NetworkFetchRequest {
  url: string;
  method?: "GET" | "HEAD";
  headers?: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxBodyBytes: number;
  signal?: AbortSignal;
}

export interface NetworkFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

/**
 * Host-injected HTTP client for network tools.
 * Implementations MUST reject non-http(s) schemes and honor timeouts/byte caps.
 */
export interface NetworkPort {
  fetch(request: NetworkFetchRequest): Promise<NetworkFetchResult>;
}
