/**
 * Optional host store for full tool payloads when model-facing output is bounded.
 * Restrict-only: never widens grants; spill is for recovery / host UI, not model context.
 */
export interface ToolOutputSpillStoreRequest {
  callId: string;
  toolName: string;
  /** Full UTF-8 payload (usually JSON.stringify of the tool output). */
  payload: string;
}

export interface ToolOutputSpillStoreResult {
  spillId: string;
  /** Host path or URI when durable; omit for in-memory spills. */
  location?: string;
}

export interface ToolOutputSpillPort {
  store(
    request: ToolOutputSpillStoreRequest,
  ): Promise<ToolOutputSpillStoreResult>;
  /** Optional read-back for hosts / tests. */
  read?(spillId: string): Promise<string | undefined>;
}
