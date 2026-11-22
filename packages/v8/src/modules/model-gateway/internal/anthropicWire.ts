import type { ModelMessage, ModelRequest } from "../contracts/types";

export interface AnthropicContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export interface AnthropicStreamPayload {
  type?: string;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  message?: AnthropicMessageResponse;
}

/**
 * Returns a copy of `items` with `cache_control: {type:"ephemeral"}`
 * added to the last entry. Anthropic caches everything up to and
 * including a marked entry, so one trailing breakpoint per array is
 * enough — used for both the tool-definition list and, via
 * {@link markMessageCacheBreakpoint}, a message's content blocks.
 */
export function markLastCacheBreakpoint<T extends Record<string, unknown>>(
  items: readonly T[],
): T[] {
  if (items.length === 0) return [...items];
  const copy = [...items];
  const lastIndex = copy.length - 1;
  copy[lastIndex] = {
    ...copy[lastIndex],
    cache_control: { type: "ephemeral" },
  };
  return copy;
}

/**
 * Marks the last content block of the last message as a cache
 * breakpoint. Anthropic matches the longest previously-cached prefix,
 * so re-marking the tail on every turn lets a growing agentic
 * conversation's stable history stay cached across turns without any
 * bespoke "what changed since last turn" tracking here.
 */
export function markMessageCacheBreakpoint(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (messages.length === 0) return messages;
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex] as { content: unknown };
  if (!Array.isArray(last.content) || last.content.length === 0) {
    return messages;
  }
  const updatedContent = markLastCacheBreakpoint(
    last.content as Array<Record<string, unknown>>,
  );
  const updatedMessages = [...messages];
  updatedMessages[lastIndex] = { ...last, content: updatedContent };
  return updatedMessages;
}

export function mapAnthropicToolChoice(
  choice: ModelRequest["toolChoice"],
): Record<string, unknown> {
  if (choice === "none") {
    return { type: "none" };
  }
  if (choice === "required") {
    return { type: "any" };
  }
  return { type: "auto" };
}

export function mapAnthropicMessages(messages: readonly ModelMessage[]): {
  system?: string;
  messages: Array<Record<string, unknown>>;
} {
  const systemParts: string[] = [];
  const conversation: Array<{
    role: "user" | "assistant";
    content: unknown[];
  }> = [];
  let pendingToolResults: unknown[] = [];

  const flushToolResults = (): void => {
    if (pendingToolResults.length === 0) {
      return;
    }
    conversation.push({
      role: "user",
      content: pendingToolResults,
    });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) {
        systemParts.push(message.content);
      }
      continue;
    }

    if (message.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.toolCallId ?? message.name ?? "tool",
        content: message.content,
      });
      continue;
    }

    flushToolResults();

    if (message.role === "assistant") {
      conversation.push({
        role: "assistant",
        content: assistantContent(message),
      });
      continue;
    }

    conversation.push({
      role: "user",
      content: userContent(message),
    });
  }

  flushToolResults();

  const merged = mergeConsecutive(conversation);
  return {
    ...(systemParts.length > 0
      ? { system: systemParts.join("\n\n") }
      : {}),
    messages:
      merged.length > 0
        ? merged
        : [{ role: "user", content: systemParts.join("\n\n") || "Hello" }],
  };
}

function userContent(message: ModelMessage): unknown[] {
  const blocks: unknown[] = [];
  if (message.content) {
    blocks.push({ type: "text", text: message.content });
  }
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind !== "image") continue;
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: attachment.data,
      },
    });
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

function assistantContent(message: ModelMessage): unknown[] {
  const blocks: unknown[] = [];
  if (message.content) {
    blocks.push({ type: "text", text: message.content });
  }
  for (const toolCall of message.toolCalls ?? []) {
    let input: unknown = {};
    try {
      input = toolCall.arguments
        ? (JSON.parse(toolCall.arguments) as unknown)
        : {};
    } catch {
      input = { raw: toolCall.arguments };
    }
    blocks.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.name,
      input,
    });
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

function mergeConsecutive(
  messages: Array<{ role: "user" | "assistant"; content: unknown[] }>,
): Array<Record<string, unknown>> {
  const merged: Array<{ role: "user" | "assistant"; content: unknown[] }> =
    [];
  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = [...last.content, ...message.content];
      continue;
    }
    merged.push({
      role: message.role,
      content: [...message.content],
    });
  }
  return merged;
}
