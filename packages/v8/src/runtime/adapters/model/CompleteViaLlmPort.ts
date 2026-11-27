import type {
  LlmPort,
  ModelRequest,
  ModelToolDefinition,
  ModelTokenUsage,
} from "../../../modules/model-gateway";
import type {
  RuntimeModelCompleteOptions,
  RuntimeModelPort,
  RuntimeModelRequest,
  RuntimeModelResponse,
  RuntimeModelUsage,
  RuntimeToolCall,
} from "../../ports/RuntimeModelPort";

export type CompleteViaLlmPortOptions = {
  /** Full tool schemas for names offered on the grant surface. */
  toolDefinitions?: readonly ModelToolDefinition[];
};

/**
 * Adapt modules/model-gateway LlmPort → RuntimeModelPort.
 * Forwards stream events via onEvent so hosts can show thinking/answer live.
 * Reasoning-only models (e.g. gpt-oss) often emit reasoning_delta with empty
 * content — fall back so the shell does not finish with an empty answer.
 */
export function completeViaLlmPort(
  llm: LlmPort,
  options?: CompleteViaLlmPortOptions,
): RuntimeModelPort {
  const byName = indexToolDefinitions(options?.toolDefinitions);
  return {
    async complete(
      request: RuntimeModelRequest,
      completeOptions?: RuntimeModelCompleteOptions,
    ): Promise<RuntimeModelResponse> {
      const onEvent = completeOptions?.onEvent;
      const modelRequest: ModelRequest = {
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
          ...(m.toolCalls && m.toolCalls.length > 0
            ? {
                toolCalls: m.toolCalls.map((call) => ({
                  id: call.callId,
                  name: call.toolId,
                  arguments: serializeToolArgs(call.args),
                })),
              }
            : {}),
        })),
        tools: request.tools.map((name) => resolveToolDefinition(name, byName)),
      };

      let text = "";
      let reasoning = "";
      let finishReason: string | undefined;
      let usage: RuntimeModelUsage | undefined;
      const reasonCodes = ["runtime_model_via_llm_port"];
      const byIndex = new Map<
        number,
        { callId: string; toolId: string; argsJson: string }
      >();

      for await (const event of llm.complete(modelRequest, {
        abortSignal: completeOptions?.abortSignal,
      })) {
        if (event.type === "content_delta") {
          text += event.content;
          onEvent?.({ type: "content_delta", content: event.content });
        }
        if (event.type === "reasoning_delta") {
          reasoning += event.reasoning;
          onEvent?.({ type: "reasoning_delta", reasoning: event.reasoning });
        }
        if (event.type === "usage") {
          usage = mergeUsage(usage, toRuntimeUsage(event.usage));
          if (usage) onEvent?.({ type: "usage", usage });
        }
        if (event.type === "completed") {
          finishReason = event.finishReason;
          if (event.usage) {
            usage = mergeUsage(usage, toRuntimeUsage(event.usage));
          }
        }
        if (event.type === "failed" || event.type === "cancelled") {
          const message =
            typeof event.error?.message === "string" && event.error.message
              ? event.error.message
              : event.type;
          reasonCodes.push(`runtime_model_${event.type}`, message.slice(0, 200));
          finishReason = event.type;
        }
        if (event.type === "tool_call_delta") {
          let announcedName: string | undefined;
          for (const delta of event.toolCalls) {
            const existing = byIndex.get(delta.index) ?? {
              callId: delta.id ?? `call_${delta.index}`,
              toolId: delta.name ?? "",
              argsJson: "",
            };
            if (delta.id) existing.callId = delta.id;
            if (delta.name) {
              existing.toolId = delta.name;
              announcedName = delta.name;
            }
            if (typeof delta.arguments === "string") {
              existing.argsJson += delta.arguments;
            }
            byIndex.set(delta.index, existing);
          }
          onEvent?.({
            type: "tool_call_delta",
            ...(announcedName ? { toolName: announcedName } : {}),
          });
        }
      }

      const trimmedText = text.trim();
      const trimmedReasoning = reasoning.trim();
      let answer = trimmedText;
      if (!answer && trimmedReasoning) {
        answer = trimmedReasoning;
        reasonCodes.push("runtime_model_reasoning_as_answer");
      }
      if (!answer) {
        reasonCodes.push("runtime_model_empty_answer");
      }

      const toolCalls: RuntimeToolCall[] = [...byIndex.values()]
        .filter((t) => t.toolId.length > 0)
        .map((t) => ({
          callId: t.callId,
          toolId: t.toolId,
          args: parseArgs(t.argsJson),
        }));

      return {
        text: answer,
        toolCalls,
        reasonCodes,
        ...(usage ? { usage } : {}),
        ...(finishReason ? { finishReason } : {}),
      };
    },
  };
}

function toRuntimeUsage(usage: ModelTokenUsage): RuntimeModelUsage {
  return {
    ...(typeof usage.inputTokens === "number"
      ? { inputTokens: usage.inputTokens }
      : {}),
    ...(typeof usage.outputTokens === "number"
      ? { outputTokens: usage.outputTokens }
      : {}),
    ...(typeof usage.cacheHitTokens === "number"
      ? { cacheHitTokens: usage.cacheHitTokens }
      : {}),
    ...(typeof usage.cacheMissTokens === "number"
      ? { cacheMissTokens: usage.cacheMissTokens }
      : {}),
  };
}

function mergeUsage(
  prior: RuntimeModelUsage | undefined,
  next: RuntimeModelUsage,
): RuntimeModelUsage {
  if (!prior) return next;
  return {
    inputTokens: pickLast(prior.inputTokens, next.inputTokens),
    outputTokens: pickLast(prior.outputTokens, next.outputTokens),
    cacheHitTokens: pickLast(prior.cacheHitTokens, next.cacheHitTokens),
    cacheMissTokens: pickLast(prior.cacheMissTokens, next.cacheMissTokens),
  };
}

/** Prefer the latest non-undefined provider value (usage events are cumulative). */
function pickLast(
  prior: number | undefined,
  next: number | undefined,
): number | undefined {
  return next ?? prior;
}

function indexToolDefinitions(
  definitions: readonly ModelToolDefinition[] | undefined,
): Map<string, ModelToolDefinition> {
  const map = new Map<string, ModelToolDefinition>();
  for (const def of definitions ?? []) {
    if (def.name) map.set(def.name, def);
  }
  return map;
}

function resolveToolDefinition(
  name: string,
  byName: Map<string, ModelToolDefinition>,
): ModelToolDefinition {
  const known = byName.get(name);
  if (known) {
    return {
      name: known.name,
      description: known.description,
      inputSchema: known.inputSchema,
    };
  }
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
  };
}

function parseArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function serializeToolArgs(args: unknown): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return "{}";
  }
}
