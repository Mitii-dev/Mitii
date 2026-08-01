import {
  TEXT_INDEX_ERRORS,
} from "./constants";

import type {
  TextIndexErrorOptions,
} from "./types";

export class TextIndexError
  extends Error
{
  public readonly operation:
    TextIndexErrorOptions["operation"];

  public readonly adapterId:
    string;

  public override readonly cause?:
    unknown;

  constructor(
    message: string,
    options:
      TextIndexErrorOptions,
  ) {
    super(message);

    this.name =
      "TextIndexError";

    this.operation =
      options.operation;

    this.adapterId =
      options.adapterId;

    if (
      options.cause !==
      undefined
    ) {
      this.cause =
        options.cause;
    }
  }
}

export function throwIfTextIndexAborted(
  abortSignal:
    AbortSignal | undefined,
  operation:
    TextIndexErrorOptions["operation"],
  adapterId: string,
): void {
  if (abortSignal?.aborted) {
    throw new TextIndexError(
      TEXT_INDEX_ERRORS.ABORTED,
      {
        operation,
        adapterId,
      },
    );
  }
}
