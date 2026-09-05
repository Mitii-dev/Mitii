import type {
  LlmPort,
  ModelEvent,
  ModelRequest,
  ModelToolCall,
  ModelToolCallDelta,
} from "../../../modules/model-gateway";

import { assembleToolCalls } from "../actions";
import { EventBus } from "../internal/EventBus";

import type { AgentEngineRuntime } from "./runtime";

export async function consumeModelTurn(
  runtime: AgentEngineRuntime,
  params: {
    llm: LlmPort;
    request: ModelRequest;
    runId: string;
    signal: AbortSignal;
    bus: EventBus;
  },
): Promise<
  | {
      kind: "completed";
      content: string;
      toolCalls: ModelToolCall[];
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheHitTokens?: number;
        cacheMissTokens?: number;
      };
      finishReason?: string;
    }
  | { kind: "cancelled" }
  | {
      kind: "failed";
      content: string;
      errorCode: string;
      errorMessage: string;
    }
> {
  const { llm, request, runId, signal, bus } = params;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolDeltas: ModelToolCallDelta[] = [];
  let usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        cacheHitTokens?: number;
        cacheMissTokens?: number;
      }
    | undefined;
  let finishReason: string | undefined;

  try {
    for await (const event of llm.complete(request, {
      runId,
      abortSignal: signal,
    })) {
      if (signal.aborted) {
        return { kind: "cancelled" };
      }
      forwardModelEvent(runtime, bus, runId, event);

      switch (event.type) {
        case "content_delta":
          contentParts.push(event.content);
          break;
        case "reasoning_delta":
          reasoningParts.push(event.reasoning);
          break;
        case "tool_call_delta":
          toolDeltas.push(...event.toolCalls);
          break;
        case "usage":
          usage = {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            cacheHitTokens: event.usage.cacheHitTokens,
            cacheMissTokens: event.usage.cacheMissTokens,
          };
          break;
        case "completed":
          finishReason = event.finishReason;
          if (event.usage) {
            usage = {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheHitTokens: event.usage.cacheHitTokens,
              cacheMissTokens: event.usage.cacheMissTokens,
            };
          }
          break;
        case "cancelled":
          return { kind: "cancelled" };
        case "failed":
          return {
            kind: "failed",
            content: contentParts.join("") || reasoningParts.join(""),
            errorCode: event.error.code,
            errorMessage: event.error.message,
          };
        default:
          break;
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }
    return {
      kind: "failed",
      content: contentParts.join("") || reasoningParts.join(""),
      errorCode: "provider_failed",
      errorMessage:
        error instanceof Error ? error.message : "Model invocation failed.",
    };
  }

  if (signal.aborted) {
    return { kind: "cancelled" };
  }

  // Some reasoning models stream only into reasoning; fall back so the UI
  // still gets a usable answer.
  const content = contentParts.join("") || reasoningParts.join("");

  return {
    kind: "completed",
    content,
    toolCalls: assembleToolCalls(toolDeltas),
    usage,
    finishReason,
  };
}

export function forwardModelEvent(
  runtime: AgentEngineRuntime,
  bus: EventBus,
  runId: string,
  event: ModelEvent,
): void {
  if (event.type === "content_delta") {
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "content",
      preview: event.content.slice(0, 200),
      at: runtime.isoNow(),
    });
    return;
  }
  if (event.type === "reasoning_delta") {
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "reasoning",
      preview: event.reasoning.slice(0, 200),
      at: runtime.isoNow(),
    });
    return;
  }
  if (event.type === "tool_call_delta") {
    const name = event.toolCalls.find((c) => c.name)?.name;
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "tool_call",
      preview: name,
      at: runtime.isoNow(),
    });
  }
}
