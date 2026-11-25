import { SoftSourceTimeoutError } from "./SoftSourceTimeoutError";
import {
  buildSourceReport,
  errorMessage,
} from "./hybridRetrievalResultBuilders";
import { retrievalSourceResultSchema } from "./schema";

import type {
  NormalizedHybridRetrievalRequest,
  ResolvedRetrievalSourceRegistration,
  RetrievalSourceExecutionResult,
  RetrievalSourceResult,
} from "./types";

export function failedExecution(
  registration: ResolvedRetrievalSourceRegistration,
  error: unknown,
): RetrievalSourceExecutionResult {
  return {
    registration,
    report: {
      ...buildSourceReport(
        registration.source.id,
        "failed",
        registration.required,
        registration.weight,
      ),
      error: errorMessage(error),
    },
    error,
  };
}

export async function withSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  sourceId: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new SoftSourceTimeoutError(sourceId, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function executeRetrievalSource(
  registration: ResolvedRetrievalSourceRegistration,
  request: NormalizedHybridRetrievalRequest,
  abortSignal: AbortSignal | undefined,
  defaultTimeoutMs: number,
): Promise<RetrievalSourceExecutionResult> {
  const timeoutMs =
    registration.timeoutMs >= 0 ? registration.timeoutMs : defaultTimeoutMs;

  try {
    const retrievePromise = registration.source.retrieve(request, {
      ...(abortSignal ? { abortSignal } : {}),
    });

    const rawResult =
      timeoutMs > 0
        ? await withSoftTimeout(
            retrievePromise,
            timeoutMs,
            registration.source.id,
          )
        : await retrievePromise;

    const result = retrievalSourceResultSchema.parse(
      rawResult,
    ) as RetrievalSourceResult;

    const status = result.status === "unavailable" ? "skipped" : result.status;

    return {
      registration,
      report: buildSourceReport(
        registration.source.id,
        status,
        registration.required,
        registration.weight,
        result.candidates.length,
        result.truncated,
        result.warnings.length,
      ),
      result,
    };
  } catch (error) {
    if (error instanceof SoftSourceTimeoutError) {
      return {
        registration,
        report: {
          ...buildSourceReport(
            registration.source.id,
            registration.required ? "failed" : "skipped",
            registration.required,
            registration.weight,
          ),
          error: error.message,
        },
        error,
      };
    }
    return failedExecution(registration, error);
  }
}
