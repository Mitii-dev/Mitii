/** Thin model boundary for the runtime turn loop (§11). */
export interface RuntimeModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface RuntimeToolCall {
  callId: string;
  toolId: string;
  args: unknown;
}

export interface RuntimeModelRequest {
  messages: RuntimeModelMessage[];
  tools: string[];
  systemPrefix?: string;
}

export interface RuntimeModelResponse {
  text: string;
  toolCalls: RuntimeToolCall[];
  reasonCodes: string[];
}

export interface RuntimeModelPort {
  complete(
    request: RuntimeModelRequest,
    options?: { abortSignal?: AbortSignal },
  ): Promise<RuntimeModelResponse>;
}
