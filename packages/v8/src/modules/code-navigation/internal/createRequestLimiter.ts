/**
 * Bounded concurrency + per-request timeout for language-service calls
 * (typically limit 3, timeout ~2s).
 *
 * Settlement contract: every request settles exactly once. Timeouts, aborts and
 * synchronous creator failures reject the promise returned to the caller; the
 * returned promise is also marked handled so fire-and-forget callers never
 * trigger `unhandledRejection`. Callers that await it still observe the error.
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

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

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
    let settled = false;
    const release = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      inflight -= 1;
      processNext();
    };
    const timeoutId = setTimeout(() => {
      if (settled) return;
      next.reject(new RequestLimiterTimeoutError(timeoutMs));
      release();
    }, timeoutMs);

    let started: Promise<unknown>;
    try {
      started = Promise.resolve(next.creator());
    } catch (error: unknown) {
      next.reject(toError(error));
      release();
      return;
    }

    started.then(
      (value) => {
        if (settled) return;
        next.resolve(value);
        release();
      },
      (error: unknown) => {
        if (settled) return;
        next.reject(toError(error));
        release();
      },
    );
  };

  return function enqueue<T>(
    creator: () => Promise<T>,
    abortSignal?: AbortSignal,
  ): Promise<T> {
    if (abortSignal?.aborted) {
      const aborted = Promise.reject<T>(new RequestLimiterAbortError());
      aborted.catch(() => undefined);
      return aborted;
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
    const settledPromise = promise.finally(() => {
      abortSignal?.removeEventListener("abort", onAbort);
    });
    settledPromise.catch(() => undefined);
    return settledPromise;
  };
}
