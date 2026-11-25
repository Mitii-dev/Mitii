import type {
  ModelEvent,
  ModelFinishReason,
  ModelToolCallDelta,
} from "../types/types";
import { iterateSseEvents } from "./sse";
import type {
  AnthropicContentBlock,
  AnthropicMessageResponse,
  AnthropicStreamPayload,
} from "./anthropicWire";

export async function* anthropicNonStreamingEvents(
  response: Response,
): AsyncIterable<ModelEvent> {
  const json = (await response.json()) as AnthropicMessageResponse;
  yield* eventsFromContent(json.content ?? [], json.stop_reason);
  const usage = mapAnthropicUsage(json.usage);
  if (usage) {
    yield { type: "usage", usage };
  }
  yield {
    type: "completed",
    finishReason: mapAnthropicStopReason(json.stop_reason),
    ...(usage ? { usage } : {}),
  };
}

export async function* anthropicStreamingEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ModelEvent> {
  const blockKindByIndex = new Map<number, string>();
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } |
    undefined;
  let finishReason: ModelFinishReason | undefined;
  let sawTerminal = false;

  for await (const event of iterateSseEvents(body)) {
    if (!event.data || event.data === "[DONE]") {
      continue;
    }

    let payload: AnthropicStreamPayload;
    try {
      payload = JSON.parse(event.data) as AnthropicStreamPayload;
    } catch {
      continue;
    }

    const type = payload.type ?? event.event;

    if (type === "content_block_start" && payload.content_block) {
      const index = payload.index ?? 0;
      blockKindByIndex.set(index, payload.content_block.type ?? "text");
      if (
        payload.content_block.type === "tool_use" &&
        (payload.content_block.id || payload.content_block.name)
      ) {
        yield {
          type: "tool_call_delta",
          toolCalls: [
            {
              index,
              id: payload.content_block.id,
              name: payload.content_block.name,
              arguments: "",
            },
          ],
        };
      }
      continue;
    }

    if (type === "content_block_delta" && payload.delta) {
      const index = payload.index ?? 0;
      const delta = payload.delta;
      if (delta.type === "text_delta" && delta.text) {
        yield { type: "content_delta", content: delta.text };
      } else if (delta.type === "thinking_delta" && delta.thinking) {
        yield { type: "reasoning_delta", reasoning: delta.thinking };
      } else if (delta.type === "input_json_delta" && delta.partial_json) {
        yield {
          type: "tool_call_delta",
          toolCalls: [
            {
              index,
              arguments: delta.partial_json,
            },
          ],
        };
      } else if (
        blockKindByIndex.get(index) === "thinking" &&
        delta.thinking
      ) {
        yield { type: "reasoning_delta", reasoning: delta.thinking };
      }
      continue;
    }

    if (type === "message_delta") {
      if (payload.delta?.stop_reason) {
        finishReason = mapAnthropicStopReason(payload.delta.stop_reason);
      }
      const nextUsage = mapAnthropicUsage(payload.usage);
      if (nextUsage) {
        usage = {
          ...usage,
          ...nextUsage,
          totalTokens:
            (usage?.inputTokens ?? nextUsage.inputTokens ?? 0) +
            (nextUsage.outputTokens ?? usage?.outputTokens ?? 0),
        };
        yield { type: "usage", usage };
      }
      continue;
    }

    if (type === "message_stop" && !sawTerminal) {
      sawTerminal = true;
      yield {
        type: "completed",
        finishReason: finishReason ?? "stop",
        ...(usage ? { usage } : {}),
      };
    }
  }

  if (!sawTerminal) {
    yield {
      type: "completed",
      finishReason: finishReason ?? "stop",
      ...(usage ? { usage } : {}),
    };
  }
}

function* eventsFromContent(
  content: AnthropicContentBlock[],
  stopReason?: string | null,
): Iterable<ModelEvent> {
  const toolCalls: ModelToolCallDelta[] = [];
  for (const [index, block] of content.entries()) {
    if (block.type === "text" && block.text) {
      yield { type: "content_delta", content: block.text };
    } else if (
      (block.type === "thinking" || block.thinking) &&
      block.thinking
    ) {
      yield { type: "reasoning_delta", reasoning: block.thinking };
    } else if (block.type === "tool_use") {
      toolCalls.push({
        index,
        id: block.id,
        name: block.name,
        arguments:
          typeof block.input === "string"
            ? block.input
            : JSON.stringify(block.input ?? {}),
      });
    }
  }
  if (toolCalls.length > 0) {
    yield { type: "tool_call_delta", toolCalls };
  }
  void stopReason;
}

export function mapAnthropicUsage(usage?: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}):
  | {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cacheHitTokens?: number;
      cacheMissTokens?: number;
    }
  | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheHitTokens = usage.cache_read_input_tokens;
  const cacheMissTokens = usage.input_tokens;
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheHitTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
  };
}

export function mapAnthropicStopReason(reason: string | null | undefined): ModelFinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "refusal":
      return "content_filter";
    default:
      return reason ? "unknown" : "stop";
  }
}
