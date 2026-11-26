import type { ModelMessage } from "../contracts";

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  /** Gemini REST JSON uses camelCase; some payloads may use snake_case. */
  thoughtSignature?: string;
  thought_signature?: string;
  inlineData?: { mimeType?: string; data?: string };
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: {
    name?: string;
    response?: Record<string, unknown>;
  };
}

export interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string | null;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

export function mapGeminiMessages(messages: readonly ModelMessage[]): {
  systemInstruction?: string;
  contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }>;
} {
  const systemParts: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> =
    [];
  let pendingToolParts: GeminiPart[] = [];

  const flushTools = (): void => {
    if (pendingToolParts.length === 0) return;
    contents.push({ role: "user", parts: pendingToolParts });
    pendingToolParts = [];
  };

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) {
        systemParts.push(message.content);
      }
      continue;
    }

    if (message.role === "tool") {
      pendingToolParts.push({
        functionResponse: {
          name: message.name ?? "tool",
          response: toolResponseObject(message.content),
        },
      });
      continue;
    }

    flushTools();

    if (message.role === "assistant") {
      contents.push({
        role: "model",
        parts: assistantParts(message),
      });
      continue;
    }

    contents.push({
      role: "user",
      parts: userParts(message),
    });
  }

  flushTools();

  const merged = mergeConsecutive(contents);
  return {
    ...(systemParts.length > 0
      ? { systemInstruction: systemParts.join("\n\n") }
      : {}),
    contents:
      merged.length > 0
        ? merged
        : [
            {
              role: "user",
              parts: [{ text: systemParts.join("\n\n") || "Hello" }],
            },
          ],
  };
}

function userParts(message: ModelMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];
  if (message.content) {
    parts.push({ text: message.content });
  }
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind !== "image") continue;
    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.data,
      },
    });
  }
  return parts.length > 0 ? parts : [{ text: "" }];
}

function assistantParts(message: ModelMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];
  if (message.content) {
    parts.push({ text: message.content });
  }
  for (const toolCall of message.toolCalls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      const parsed = toolCall.arguments
        ? (JSON.parse(toolCall.arguments) as unknown)
        : {};
      args =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { value: parsed };
    } catch {
      args = { raw: toolCall.arguments };
    }
    const part: GeminiPart = {
      functionCall: {
        name: toolCall.name,
        args,
      },
    };
    // Gemini 3+ requires echoing thoughtSignature on functionCall parts.
    if (toolCall.thoughtSignature) {
      part.thoughtSignature = toolCall.thoughtSignature;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts : [{ text: "" }];
}

function toolResponseObject(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
}

function mergeConsecutive(
  contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }>,
): Array<{ role: "user" | "model"; parts: GeminiPart[] }> {
  const merged: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  for (const item of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) {
      last.parts = [...last.parts, ...item.parts];
      continue;
    }
    merged.push({ role: item.role, parts: [...item.parts] });
  }
  return merged;
}
