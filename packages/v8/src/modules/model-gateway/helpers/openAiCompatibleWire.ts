import type {
  ModelEvent,
  ModelFinishReason,
  ModelMessage,
  ModelTokenUsage,
  ModelToolCallDelta,
} from "../contracts";

export type OpenAiCompatibleUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

export interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAiCompatibleUsage;
}

export interface OpenAiChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAiCompatibleUsage;
}

export function formatOpenAiMessage(
  message: ModelMessage,
): Record<string, unknown> {
  const attachments =
    message.attachments?.filter(
      (attachment) => attachment.kind === "image",
    ) ?? [];

  const content =
    attachments.length > 0 &&
    (message.role === "user" || message.role === "assistant")
      ? [
          ...(message.content
            ? [{ type: "text", text: message.content }]
            : []),
          ...attachments.map((attachment) => ({
            type: "image_url",
            image_url: {
              url: `data:${attachment.mimeType};base64,${attachment.data}`,
            },
          })),
        ]
      : message.content;

  const out: Record<string, unknown> = {
    role: message.role,
    content,
  };

  if (message.name) {
    out.name = message.name;
  }

  if (message.toolCallId) {
    out.tool_call_id = message.toolCallId;
  }

  if (message.toolCalls) {
    out.tool_calls = message.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    }));
  }

  return out;
}

export function parseOpenAiSseLine(line: string): ModelEvent[] {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith(":")) {
    return [];
  }

  if (!trimmed.startsWith("data:")) {
    return [];
  }

  const payload = trimmed.slice("data:".length).trim();

  if (!payload) {
    return [];
  }

  if (payload === "[DONE]") {
    return [{ type: "completed", finishReason: "stop" }];
  }

  let chunk: OpenAiChatCompletionChunk;

  try {
    chunk = JSON.parse(payload) as OpenAiChatCompletionChunk;
  } catch {
    return [];
  }

  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  const events: ModelEvent[] = [];

  if (delta?.content) {
    events.push({ type: "content_delta", content: delta.content });
  }

  const reasoning = delta?.reasoning ?? delta?.reasoning_content;
  if (reasoning) {
    events.push({ type: "reasoning_delta", reasoning });
  }

  const toolCalls = delta?.tool_calls?.map(
    (toolCall, fallbackIndex): ModelToolCallDelta => ({
      index: toolCall.index ?? fallbackIndex,
      id: toolCall.id,
      name: toolCall.function?.name,
      arguments: toolCall.function?.arguments,
    }),
  );

  if (toolCalls && toolCalls.length > 0) {
    events.push({ type: "tool_call_delta", toolCalls });
  }

  const usage = mapOpenAiUsage(chunk.usage);

  if (usage) {
    events.push({ type: "usage", usage });
  }

  const finishReason = choice?.finish_reason;
  if (finishReason) {
    events.push({
      type: "completed",
      finishReason: mapOpenAiFinishReason(finishReason),
      ...(usage ? { usage } : {}),
    });
  }

  return events;
}

export function mapOpenAiUsage(
  usage?: OpenAiCompatibleUsage,
): ModelTokenUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const cacheHitTokens = usage.prompt_cache_hit_tokens;
  const cacheMissTokens = usage.prompt_cache_miss_tokens;
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheHitTokens === undefined &&
    cacheMissTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(usage.total_tokens !== undefined
      ? { totalTokens: usage.total_tokens }
      : {
          totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
        }),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
  };
}

export function mapOpenAiFinishReason(
  reason: string | null | undefined,
): ModelFinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return reason ? "unknown" : "stop";
  }
}

/**
 * OpenAI-compatible chat APIs require system messages only at the start of
 * the conversation. Project any later `system` turns to `user` so mid-epoch
 * updates (and legacy checkpoints) never trigger
 * "system message must be at the beginning".
 */
export function projectOpenAiCompatibleMessages(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  let seenNonSystem = false;
  return messages.map((message) => {
    if (message.role !== "system") {
      seenNonSystem = true;
      return message;
    }
    if (!seenNonSystem) {
      return message;
    }
    return { ...message, role: "user" as const };
  });
}
