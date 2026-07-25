import type {
  EmbeddingErrorOptions,
  EmbeddingOperation,
} from "./types";

export class EmbeddingError
  extends Error
{
  public readonly operation:
    EmbeddingOperation;

  public readonly componentId:
    string;

  public override readonly cause?:
    unknown;

  constructor(
    message: string,
    options:
      EmbeddingErrorOptions,
  ) {
    super(message);

    this.name =
      "EmbeddingError";
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

export function throwIfEmbeddingAborted(
  signal: AbortSignal | undefined,
  operation:
    EmbeddingOperation,
  componentId: string,
): void {
  if (!signal?.aborted) {
    return;
  }

  throw new EmbeddingError(
    "Embedding operation was cancelled.",
    {
      operation,
      componentId,
      cause:
        signal.reason,
    },
  );
}
