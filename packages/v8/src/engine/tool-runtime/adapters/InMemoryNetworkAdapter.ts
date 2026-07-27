import type { NetworkPort } from "../contracts";

export interface InMemoryNetworkResponse {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

/**
 * Deterministic NetworkPort for Tool Runtime tests.
 */
export class InMemoryNetworkAdapter implements NetworkPort {
  constructor(
    private readonly handler: (
      url: string,
    ) => Promise<InMemoryNetworkResponse> | InMemoryNetworkResponse,
  ) {}

  public async fetch(request: {
    url: string;
    method?: "GET" | "HEAD";
    headers?: Readonly<Record<string, string>>;
    timeoutMs: number;
    maxBodyBytes: number;
    signal?: AbortSignal;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    truncated: boolean;
  }> {
    if (request.signal?.aborted) {
      throw new Error("Network fetch aborted.");
    }
    const response = await this.handler(request.url);
    const encoded = Buffer.from(response.body, "utf8");
    const truncated = encoded.byteLength > request.maxBodyBytes;
    const body = truncated
      ? encoded.subarray(0, request.maxBodyBytes).toString("utf8")
      : response.body;
    return {
      status: response.status,
      headers: { ...(response.headers ?? {}) },
      body,
      truncated,
    };
  }
}
