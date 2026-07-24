import type { CodeIndexErrorOptions } from "./types";

export class CodeIndexError extends Error {
  public readonly operation: CodeIndexErrorOptions["operation"];

  public readonly adapterId: string;

  public override readonly cause?: unknown;

  constructor(message: string, options: CodeIndexErrorOptions) {
    super(message);

    this.name = "CodeIndexError";

    this.operation = options.operation;

    this.adapterId = options.adapterId;

    this.cause = options.cause;
  }
}

export function throwIfCodeIndexAborted(abortSignal?: AbortSignal): void {
  if (!abortSignal?.aborted) {
    return;
  }

  throw new DOMException("Code Index operation was cancelled.", "AbortError");
}
