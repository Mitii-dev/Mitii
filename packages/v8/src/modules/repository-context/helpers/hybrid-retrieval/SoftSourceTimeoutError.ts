import { HYBRID_RETRIEVAL_MESSAGES } from "./constants";

/** Raised when one retrieval source exceeds its soft timeout budget. */
export class SoftSourceTimeoutError extends Error {
  constructor(
    readonly sourceId: string,
    readonly timeoutMs: number,
  ) {
    super(
      `${HYBRID_RETRIEVAL_MESSAGES.SOURCE_TIMEOUT} (${sourceId}, ${timeoutMs}ms)`,
    );
    this.name = "SoftSourceTimeoutError";
  }
}
