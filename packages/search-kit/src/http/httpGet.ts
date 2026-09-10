import { MAX_REDIRECTS } from '../safety/limits.js';
import { assertHttpUrl } from '../safety/urlSafety.js';
import type { FetchImpl } from '../types.js';

export interface HttpGetOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  maxBodyBytes: number;
  signal?: AbortSignal;
  /** Allow localhost / private hosts (SearXNG, etc.). */
  allowPrivate?: boolean;
  fetchImpl?: FetchImpl;
  label?: string;
}

export interface HttpGetResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

/**
 * Bounded HTTP GET with manual redirects, timeout, and byte caps.
 * Never shells out. Does not log response bodies.
 */
export async function httpGet(options: HttpGetOptions): Promise<HttpGetResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = options.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertHttpUrl(current, {
      allowPrivate: options.allowPrivate === true,
      label: options.label ?? 'Request URL',
    });

    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);

    try {
      const response = await fetchImpl(current, {
        method: 'GET',
        headers: options.headers,
        redirect: 'manual',
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (timedOut) {
          const timeoutError = new Error(
            `Request timed out after ${options.timeoutMs}ms.`,
          ) as NodeJS.ErrnoException;
          timeoutError.code = 'ETIMEDOUT';
          throw timeoutError;
        }
        throw error;
      });

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get('location')
      ) {
        current = new URL(
          response.headers.get('location')!,
          current,
        ).toString();
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const truncated = buffer.byteLength > options.maxBodyBytes;
      const body = truncated
        ? buffer.subarray(0, options.maxBodyBytes).toString('utf8')
        : buffer.toString('utf8');

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        url: current,
        status: response.status,
        headers,
        body,
        truncated,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw new Error(`Too many redirects fetching "${options.url}".`);
}

/** Strip secrets from error messages (API keys in URLs/query). */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/([?&](?:api_?key|token|key|subscription)=)[^&\s]+/gi, '$1***')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/\bsk-[A-Za-z0-9]+/g, 'sk-***');
}
