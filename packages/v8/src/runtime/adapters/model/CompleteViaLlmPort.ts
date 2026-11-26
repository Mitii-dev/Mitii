import type { LlmPort, ModelRequest } from "../../../modules/model-gateway";
import type {
  RuntimeModelPort,
  RuntimeModelRequest,
  RuntimeModelResponse,
  RuntimeToolCall,
} from "../../ports/RuntimeModelPort";

/**
 * Adapt modules/model-gateway LlmPort → RuntimeModelPort.
 * Drains the event stream into text + toolCalls.
 */
export function completeViaLlmPort(llm: LlmPort): RuntimeModelPort {
  return {
    async complete(
      request: RuntimeModelRequest,
      options?: { abortSignal?: AbortSignal },
    ): Promise<RuntimeModelResponse> {
      const modelRequest: ModelRequest = {
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        tools: request.tools.map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object", properties: {} },
        })),
      };

      let text = "";
      const byIndex = new Map<
        number,
        { callId: string; toolId: string; argsJson: string }
      >();

      for await (const event of llm.complete(modelRequest, {
        abortSignal: options?.abortSignal,
      })) {
        if (event.type === "content_delta") {
          text += event.content;
        }
        if (event.type === "tool_call_delta") {
          for (const delta of event.toolCalls) {
            const existing = byIndex.get(delta.index) ?? {
              callId: delta.id ?? `call_${delta.index}`,
              toolId: delta.name ?? "",
              argsJson: "",
            };
            if (delta.id) existing.callId = delta.id;
            if (delta.name) existing.toolId = delta.name;
            if (typeof delta.arguments === "string") {
              existing.argsJson += delta.arguments;
            }
            byIndex.set(delta.index, existing);
          }
        }
      }

      const toolCalls: RuntimeToolCall[] = [...byIndex.values()]
        .filter((t) => t.toolId.length > 0)
        .map((t) => ({
          callId: t.callId,
          toolId: t.toolId,
          args: parseArgs(t.argsJson),
        }));

      return {
        text,
        toolCalls,
        reasonCodes: ["runtime_model_via_llm_port"],
      };
    },
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
