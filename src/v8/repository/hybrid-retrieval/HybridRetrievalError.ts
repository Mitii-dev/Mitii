import {
  HYBRID_RETRIEVAL_MESSAGES,
} from "./constants";

import type {
  HybridRetrievalErrorOptions,
  HybridRetrievalOperation,
} from "./types";

export class HybridRetrievalError
  extends Error
{
  public readonly operation:
    HybridRetrievalOperation;

  public readonly componentId:
    string;

  public override readonly cause?:
    unknown;

  constructor(
    message: string,
    options:
      HybridRetrievalErrorOptions,
  ) {
    super(message);

    this.name =
      "HybridRetrievalError";
    this.operation =
      options.operation;
    this.componentId =
      options.componentId;

    if (
      options.cause !==
      undefined
    ) {
      this.cause =
        options.cause;
    }
  }
}

export function throwIfHybridRetrievalAborted(
  signal: AbortSignal | undefined,
  operation:
    HybridRetrievalOperation,
  componentId: string,
): void {
  if (!signal?.aborted) {
    return;
  }

  throw new HybridRetrievalError(
    HYBRID_RETRIEVAL_MESSAGES
      .CANCELLED,
    {
      operation,
      componentId,
      cause:
        signal.reason,
    },
  );
}
