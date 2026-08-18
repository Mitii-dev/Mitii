import type {
  NetworkFetchRequest,
  NetworkFetchResult,
  NetworkPort,
} from "../contracts";

const MAX_REDIRECTS = 3;

/**
 * HTTP(S) fetch adapter. Rejects non-http(s) URLs. Follows a bounded number
 * of redirects. Never uses a shell.
 */
export class NodeNetworkAdapter implements NetworkPort {
  public async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResult> {
    let current = request.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const parsed = new URL(current);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
      }

      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      request.signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, request.timeoutMs);

      try {
        const response = await fetch(current, {
          method: request.method ?? "GET",
          headers: request.headers
            ? { ...request.headers }
            : undefined,
          redirect: "manual",
          signal: controller.signal,
        }).catch((error) => {
          // Distinguish "our timeout fired" from "caller cancelled" —
          // both abort the same AbortController and would otherwise
          // produce an identical, generically-worded AbortError.
          if (timedOut) {
            const timeoutError = new Error(
              `Request to "${current}" timed out after ${request.timeoutMs}ms.`,
            ) as NodeJS.ErrnoException;
            timeoutError.code = "ETIMEDOUT";
            throw timeoutError;
          }
          throw error;
        });

        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.get("location")
        ) {
          const next = new URL(
            response.headers.get("location")!,
            current,
          ).toString();
          current = next;
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const truncated = buffer.byteLength > request.maxBodyBytes;
        const body = truncated
          ? buffer.subarray(0, request.maxBodyBytes).toString("utf8")
          : buffer.toString("utf8");

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        return {
          status: response.status,
          headers,
          body,
          truncated,
        };
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
      }
    }

    throw new Error(`Too many redirects fetching "${request.url}".`);
  }
}
