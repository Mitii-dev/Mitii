/**
 * Bounded concurrency + per-request timeout for language-service calls.
 * Pattern from Cody's lsp request limiter (limit 3, timeout ~2s).
 */
export type RequestLimiter = <T>(
  creator: () => Promise<T>,
  abortSignal?: AbortSignal,
) => Promise<T>;

export class RequestLimiterTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Code navigation request timed out after ${timeoutMs}ms.`);
    this.name = "RequestLimiterTimeoutError";
  }
}

export class RequestLimiterAbortError extends Error {
  constructor() {
    super("Code navigation request was aborted.");
    this.name = "RequestLimiterAbortError";
  }
}

export function createRequestLimiter(params: {
  limit: number;
  timeoutMs: number;
}): RequestLimiter {
  const { limit, timeoutMs } = params;
  const queue: Array<{
    creator: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }> = [];
  let inflight = 0;

  const processNext = (): void => {
    if (inflight >= limit || queue.length === 0) return;
    const next = queue.shift()!;
    inflight += 1;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      next.reject(new RequestLimiterTimeoutError(timeoutMs));
      inflight -= 1;
      processNext();
    }, timeoutMs);

    next
      .creator()
      .then((value) => {
        if (!timedOut) next.resolve(value);
      })
      .catch((error: unknown) => {
        if (!timedOut) {
          next.reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
      .finally(() => {
        if (timedOut) return;
        clearTimeout(timeoutId);
        inflight -= 1;
        processNext();
      });
  };

  return function enqueue<T>(
    creator: () => Promise<T>,
    abortSignal?: AbortSignal,
  ): Promise<T> {
    if (abortSignal?.aborted) {
      return Promise.reject(new RequestLimiterAbortError());
    }

    let queued: (typeof queue)[number] | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      queued = {
        creator: () => creator(),
        resolve: (value) => resolve(value as T),
        reject,
      };
      queue.push(queued);
    });

    const onAbort = () => {
      if (!queued) return;
      const index = queue.indexOf(queued);
      if (index < 0) return;
      queue.splice(index, 1);
      queued.reject(new RequestLimiterAbortError());
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    processNext();
    return promise.finally(() => {
      abortSignal?.removeEventListener("abort", onAbort);
    });
  };
}
