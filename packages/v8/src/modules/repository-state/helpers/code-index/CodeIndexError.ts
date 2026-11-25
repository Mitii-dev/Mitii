import type {
  CodeIndexErrorOptions,
  CodeIndexOperation,
} from "./types";

export class CodeIndexError extends Error {
  public readonly operation: CodeIndexOperation;
  public readonly adapterId: string;
  public override readonly cause?: unknown;

  constructor(
    message: string,
    options: CodeIndexErrorOptions,
  ) {
    super(message);
    this.name = "CodeIndexError";
    this.operation = options.operation;
    this.adapterId = options.adapterId;
    this.cause = options.cause;
  }
}

export const throwIfCodeIndexAborted = (
  abortSignal?: AbortSignal,
): void => {
  if (!abortSignal?.aborted) {
    return;
  }

  const error = new Error(
    "Code Index operation was aborted.",
  );

  error.name = "AbortError";

  throw error;
};

