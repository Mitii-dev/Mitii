import type {
  SourceFileReadErrorCode,
} from "./types";

export class SourceFileReadError
  extends Error {
  public override readonly name =
    "SourceFileReadError";

  constructor(
    public readonly code:
      SourceFileReadErrorCode,
    public readonly path: string,
    message: string,
    options?: {
      cause?: unknown;
    },
  ) {
    super(message, options);
  }
}
