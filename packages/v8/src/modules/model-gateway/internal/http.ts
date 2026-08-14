import {
  HTTP_STATUS_TO_MODEL_ERROR,
  MODEL_GATEWAY_LIMITS,
  MODEL_GATEWAY_MESSAGES,
} from "../constants";
import type { ModelError, ModelErrorCode, ModelEvent } from "../contracts/types";

export function defaultSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function parseRetryAfterMs(headers?: Headers): number | undefined {
  if (!headers) return undefined;
  const raw = headers.get("retry-after");
  if (!raw?.trim()) return undefined;

  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(
      Math.floor(asSeconds * 1_000),
      MODEL_GATEWAY_LIMITS.MAXIMUM_RETRY_AFTER_MS,
    );
  }

  const asDate = Date.parse(raw);
  if (!Number.isFinite(asDate)) return undefined;
  const delta = asDate - Date.now();
  if (delta <= 0) return 0;
  return Math.min(delta, MODEL_GATEWAY_LIMITS.MAXIMUM_RETRY_AFTER_MS);
}

export function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

export function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

export function backoffDelayMs(options: {
  attempt: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  retryAfterMs?: number;
}): number {
  if (
    typeof options.retryAfterMs === "number" &&
    Number.isFinite(options.retryAfterMs) &&
    options.retryAfterMs > 0
  ) {
    return Math.min(
      Math.floor(options.retryAfterMs),
      MODEL_GATEWAY_LIMITS.MAXIMUM_RETRY_AFTER_MS,
    );
  }

  const exponential = options.initialBackoffMs * 2 ** options.attempt;
  const capped = Math.min(exponential, options.maxBackoffMs);
  const jitter = Math.floor(Math.random() * Math.max(1, capped * 0.2));
  return capped + jitter;
}

export function cancelledEvent(message: string): ModelEvent {
  return {
    type: "cancelled",
    error: {
      code: "cancelled",
      message,
      retryable: false,
    },
  };
}

export function toTransportError(error: unknown): ModelError {
  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: "cancelled",
      message: "Request was aborted.",
      retryable: false,
    };
  }

  return {
    code: "provider_unavailable",
    message:
      error instanceof Error ? error.message : "Provider request failed.",
    retryable: true,
  };
}

export function mapHttpStatusError(options: {
  status: number;
  body: string;
  headers?: Headers;
  modelId?: string;
}): ModelError {
  const code: ModelErrorCode =
    HTTP_STATUS_TO_MODEL_ERROR[options.status] ?? "unknown";
  const preview = options.body
    .slice(0, MODEL_GATEWAY_LIMITS.ERROR_BODY_PREVIEW_CHARACTERS)
    .trim();
  const retryAfterMs = parseRetryAfterMs(options.headers);

  if (options.status === 401 || options.status === 403) {
    return {
      code: "authentication_failed",
      message: MODEL_GATEWAY_MESSAGES.AUTHENTICATION_FAILED,
      retryable: false,
      providerCode: String(options.status),
    };
  }

  if (options.status === 404) {
    return {
      code: "invalid_request",
      message: options.modelId
        ? `${MODEL_GATEWAY_MESSAGES.MODEL_NOT_FOUND} (${options.modelId})`
        : MODEL_GATEWAY_MESSAGES.MODEL_NOT_FOUND,
      retryable: false,
      providerCode: String(options.status),
    };
  }

  return {
    code,
    message: preview
      ? `Provider returned ${options.status}: ${preview}`
      : `Provider returned ${options.status}.`,
    retryable: code === "rate_limited" || code === "provider_unavailable",
    providerCode: String(options.status),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

export function approximateTokenCount(text: string): number {
  return Math.max(
    1,
    Math.ceil(text.length / MODEL_GATEWAY_LIMITS.APPROXIMATE_CHARS_PER_TOKEN),
  );
}

export interface ProviderHttpCompleteOptions {
  url: string;
  headers: Record<string, string>;
  body: string;
  stream: boolean;
  abortSignal?: AbortSignal;
  fetchImpl: typeof fetch;
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;
  mapHttpError: (
    status: number,
    body: string,
    headers?: Headers,
  ) => ModelError;
  yieldNonStreaming: (response: Response) => AsyncIterable<ModelEvent>;
  yieldStreaming: (
    body: ReadableStream<Uint8Array>,
  ) => AsyncIterable<ModelEvent>;
}

export async function* completeWithHttpRetry(
  options: ProviderHttpCompleteOptions,
): AsyncIterable<ModelEvent> {
  if (options.abortSignal?.aborted) {
    yield cancelledEvent("Request was aborted before completion.");
    return;
  }

  let attempt = 0;
  let lastError: ModelError | undefined;

  while (attempt <= options.maxRetries) {
    if (options.abortSignal?.aborted) {
      yield cancelledEvent("Request was aborted before completion.");
      return;
    }

    let response: Response;

    try {
      response = await options.fetchImpl(options.url, {
        method: "POST",
        headers: options.headers,
        body: options.body,
        signal: options.abortSignal,
      });
    } catch (error) {
      if (options.abortSignal?.aborted) {
        yield cancelledEvent("Request was aborted during transport.");
        return;
      }

      lastError = toTransportError(error);
      if (!lastError.retryable || attempt >= options.maxRetries) {
        yield {
          type: "failed",
          finishReason: lastError.code === "cancelled" ? "cancelled" : "error",
          error: lastError,
        };
        return;
      }

      try {
        await options.sleepImpl(
          backoffDelayMs({
            attempt,
            initialBackoffMs: options.initialBackoffMs,
            maxBackoffMs: options.maxBackoffMs,
            retryAfterMs: lastError.retryAfterMs,
          }),
          options.abortSignal,
        );
      } catch (sleepError) {
        if (
          options.abortSignal?.aborted ||
          (sleepError instanceof Error && sleepError.name === "AbortError")
        ) {
          yield cancelledEvent("Request was aborted during retry backoff.");
          return;
        }
        throw sleepError;
      }
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      lastError = options.mapHttpError(
        response.status,
        text,
        response.headers,
      );
      if (!lastError.retryable || attempt >= options.maxRetries) {
        yield {
          type: "failed",
          finishReason: "error",
          error: lastError,
        };
        return;
      }

      try {
        await options.sleepImpl(
          backoffDelayMs({
            attempt,
            initialBackoffMs: options.initialBackoffMs,
            maxBackoffMs: options.maxBackoffMs,
            retryAfterMs: lastError.retryAfterMs,
          }),
          options.abortSignal,
        );
      } catch (sleepError) {
        if (
          options.abortSignal?.aborted ||
          (sleepError instanceof Error && sleepError.name === "AbortError")
        ) {
          yield cancelledEvent("Request was aborted during retry backoff.");
          return;
        }
        throw sleepError;
      }
      attempt += 1;
      continue;
    }

    if (!options.stream) {
      yield* options.yieldNonStreaming(response);
      return;
    }

    if (!response.body) {
      lastError = {
        code: "provider_unavailable",
        message: MODEL_GATEWAY_MESSAGES.EMPTY_RESPONSE_BODY,
        retryable: true,
      };
      if (attempt >= options.maxRetries) {
        yield {
          type: "failed",
          finishReason: "error",
          error: lastError,
        };
        return;
      }

      try {
        await options.sleepImpl(
          backoffDelayMs({
            attempt,
            initialBackoffMs: options.initialBackoffMs,
            maxBackoffMs: options.maxBackoffMs,
            retryAfterMs: lastError.retryAfterMs,
          }),
          options.abortSignal,
        );
      } catch (sleepError) {
        if (
          options.abortSignal?.aborted ||
          (sleepError instanceof Error && sleepError.name === "AbortError")
        ) {
          yield cancelledEvent("Request was aborted during retry backoff.");
          return;
        }
        throw sleepError;
      }
      attempt += 1;
      continue;
    }

    yield* options.yieldStreaming(response.body);
    return;
  }

  yield {
    type: "failed",
    finishReason: "error",
    error: lastError ?? {
      code: "provider_unavailable",
      message: "Provider request failed after retries.",
      retryable: true,
    },
  };
}
