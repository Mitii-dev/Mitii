import type { ModelFinishReason } from "../types/types";
import type { GeminiPart } from "./geminiMessages";

export function readGeminiThoughtSignature(part: GeminiPart): string | undefined {
  const value = part.thoughtSignature ?? part.thought_signature;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function mapGeminiUsage(usage?: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}):
  | {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }
  | undefined {
  if (!usage) return undefined;
  return {
    ...(usage.promptTokenCount !== undefined
      ? { inputTokens: usage.promptTokenCount }
      : {}),
    ...(usage.candidatesTokenCount !== undefined
      ? { outputTokens: usage.candidatesTokenCount }
      : {}),
    ...(usage.totalTokenCount !== undefined
      ? { totalTokens: usage.totalTokenCount }
      : {}),
  };
}

export function mapGeminiFinishReason(
  reason: string | null | undefined,
  parts?: GeminiPart[],
): ModelFinishReason {
  if (parts?.some((part) => part.functionCall?.name)) {
    return "tool_calls";
  }
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
      return "content_filter";
    case "MALFORMED_FUNCTION_CALL":
      return "error";
    default:
      if (reason?.includes("FUNCTION") || reason === "TOOL_CODE") {
        return "tool_calls";
      }
      return reason ? "unknown" : "stop";
  }
}
