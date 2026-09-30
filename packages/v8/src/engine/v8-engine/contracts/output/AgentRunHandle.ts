import type { AgentRunResult } from "./AgentRunResult";
import type { RunEvent } from "./RunEvent";

/**
 * Opaque handle returned by AgentEnginePipeline.start.
 * Events reconstruct the run without exposing secrets.
 */
export interface AgentRunHandle {
  readonly runId: string;
  readonly events: AsyncIterable<RunEvent>;
  readonly result: Promise<AgentRunResult>;
  cancel(reason?: string): void;
}
