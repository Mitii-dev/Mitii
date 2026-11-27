/** Thin model boundary for the runtime turn loop (§11). */

export interface RuntimeToolCall {
  callId: string;
  toolId: string;
  args: unknown;
}

export interface RuntimeModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  /**
   * Required on assistant turns that invoke tools — OpenAI-compatible
   * providers reject orphan `role:tool` messages without a prior tool_calls.
   */
  toolCalls?: readonly RuntimeToolCall[];
}

export interface RuntimeModelRequest {
  messages: RuntimeModelMessage[];
  tools: string[];
  systemPrefix?: string;
}

/** Provider token usage for one complete() call (generic — not vendor-shaped). */
export interface RuntimeModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

/**
 * Progressive stream events for hosts (Desktop thinking / answer / tool hints).
 * Adapters map provider events here; the turn loop maps these to RunEvent.
 */
export type RuntimeModelStreamEvent =
  | { type: "content_delta"; content: string }
  | { type: "reasoning_delta"; reasoning: string }
  | { type: "tool_call_delta"; toolName?: string }
  | { type: "usage"; usage: RuntimeModelUsage };

export interface RuntimeModelResponse {
  text: string;
  toolCalls: RuntimeToolCall[];
  reasonCodes: string[];
  usage?: RuntimeModelUsage;
  finishReason?: string;
}

export interface RuntimeModelCompleteOptions {
  abortSignal?: AbortSignal;
  /** Live stream callback — hosts see thinking/answer before the turn settles. */
  onEvent?: (event: RuntimeModelStreamEvent) => void;
}

export interface RuntimeModelPort {
  complete(
    request: RuntimeModelRequest,
    options?: RuntimeModelCompleteOptions,
  ): Promise<RuntimeModelResponse>;
}
