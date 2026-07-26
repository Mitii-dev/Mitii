import type {
  CodeIndexWriteErrorOptions,
} from "./types";

export class CodeIndexWriteError extends Error {
  public readonly operation:
    CodeIndexWriteErrorOptions["operation"];

  public readonly adapterId: string;

  constructor(
    message: string,
    options: CodeIndexWriteErrorOptions,
  ) {
    super(message, {
      cause: options.cause,
    });

    this.name = "CodeIndexWriteError";
    this.operation = options.operation;
    this.adapterId = options.adapterId;
  }
}

export function throwIfCodeIndexWriteAborted(
  abortSignal?: AbortSignal,
): void {
  if (!abortSignal?.aborted) {
    return;
  }

  const error = new Error(
    "Code Index write was aborted.",
  );

  error.name = "AbortError";

  throw error;
}
