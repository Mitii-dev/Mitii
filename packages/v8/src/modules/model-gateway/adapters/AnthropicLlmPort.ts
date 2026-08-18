import {
  ANTHROPIC_DEFAULTS,
  MODEL_GATEWAY_DEFAULTS,
  MODEL_GATEWAY_IDS,
} from "../constants";
import { modelRequestSchema } from "../contracts/schema";
import type {
  LlmPort,
  ModelCallContext,
  ModelCapabilities,
  ModelError,
  ModelEvent,
  ModelFinishReason,
  ModelMessage,
  ModelRequest,
  ModelToolCallDelta,
  ResolveModelCapabilitiesInput,
} from "../contracts/types";
import {
  approximateTokenCount,
  cancelledEvent,
  completeWithHttpRetry,
  defaultSleep,
  mapHttpStatusError,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
} from "../internal/http";
import { iterateSseEvents } from "../internal/sse";
import { ModelCapabilityResolver } from "../ModelCapabilityResolver";

export interface AnthropicLlmPortConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  version?: string;
  messagesPath?: string;
  providerId?: string;
  defaultHeaders?: Readonly<Record<string, string>>;
  capabilities?: Partial<
    Omit<ResolveModelCapabilitiesInput, "modelId" | "contextWindowTokens">
  > & {
    contextWindowTokens?: number;
  };
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface AnthropicStreamPayload {
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
 * Native Anthropic Messages API adapter (Claude).
 * Hosts inject apiKey; V8 never reads environment secrets.
 */
export class AnthropicLlmPort implements LlmPort {
  public readonly id: string;
  public readonly capabilities: ModelCapabilities;

  private readonly config: Required<
    Pick<
      AnthropicLlmPortConfig,
      "baseUrl" | "model" | "version" | "messagesPath"
    >
  > &
    AnthropicLlmPortConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleepImpl: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  constructor(config: AnthropicLlmPortConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl ?? ANTHROPIC_DEFAULTS.BASE_URL,
      model: config.model,
      version: config.version ?? ANTHROPIC_DEFAULTS.VERSION,
      messagesPath: config.messagesPath ?? ANTHROPIC_DEFAULTS.MESSAGES_PATH,
    };
    this.id = config.providerId ?? MODEL_GATEWAY_IDS.ANTHROPIC_PORT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = normalizeNonNegativeInteger(
      config.maxRetries,
      ANTHROPIC_DEFAULTS.MAX_RETRIES,
    );
    this.initialBackoffMs = normalizePositiveInteger(
      config.initialBackoffMs,
      ANTHROPIC_DEFAULTS.INITIAL_BACKOFF_MS,
    );
    this.maxBackoffMs = normalizePositiveInteger(
      config.maxBackoffMs,
      ANTHROPIC_DEFAULTS.MAX_BACKOFF_MS,
    );
    this.sleepImpl = config.sleepImpl ?? defaultSleep;
    this.capabilities = new ModelCapabilityResolver().resolve({
      modelId: config.model,
      contextWindowTokens:
        config.capabilities?.contextWindowTokens ??
        ANTHROPIC_DEFAULTS.CONTEXT_WINDOW_TOKENS,
      maximumOutputTokens:
        config.capabilities?.maximumOutputTokens ??
        ANTHROPIC_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
      supportsStreaming: config.capabilities?.supportsStreaming ?? true,
      supportsTools: config.capabilities?.supportsTools ?? true,
      supportsParallelToolCalls:
        config.capabilities?.supportsParallelToolCalls ?? true,
      supportsStructuredOutput:
        config.capabilities?.supportsStructuredOutput ?? false,
      supportsVision: config.capabilities?.supportsVision ?? true,
      supportsReasoning: config.capabilities?.supportsReasoning ?? true,
      // Native Anthropic Messages API supports `cache_control` breakpoints
      // unconditionally (GA on the stable "2023-06-01" version header, no
      // beta flag needed) — unlike the module-wide default, this adapter
      // can safely default to on. Hosts can still opt out per config.
      supportsPromptCaching:
        config.capabilities?.supportsPromptCaching ?? true,
      supportsEmbeddings: config.capabilities?.supportsEmbeddings ?? false,
      ...(config.capabilities?.agenticTier
        ? { agenticTier: config.capabilities.agenticTier }
        : {}),
    });
  }

  public async *complete(
    request: ModelRequest,
    context?: ModelCallContext,
  ): AsyncIterable<ModelEvent> {
    if (context?.abortSignal?.aborted) {
      yield cancelledEvent("Request was aborted before completion.");
      return;
    }

    const normalized = modelRequestSchema.parse(request);
    const stream = normalized.stream !== false;
    const url = this.buildUrl();
    const headers = this.buildHeaders();
    const body = JSON.stringify(this.buildBody(normalized, stream));

    yield* completeWithHttpRetry({
      url,
      headers,
      body,
      stream,
      abortSignal: context?.abortSignal,
      fetchImpl: this.fetchImpl,
      maxRetries: this.maxRetries,
      initialBackoffMs: this.initialBackoffMs,
      maxBackoffMs: this.maxBackoffMs,
      sleepImpl: this.sleepImpl,
      mapHttpError: (status, text, responseHeaders) =>
        this.mapHttpError(status, text, responseHeaders),
      yieldNonStreaming: (response) => this.yieldNonStreaming(response),
      yieldStreaming: (responseBody) => this.yieldStreaming(responseBody),
    });
  }

  public async countTokens(text: string): Promise<number> {
    return approximateTokenCount(text);
  }

  private buildUrl(): string {
    const root = this.config.baseUrl.replace(/\/$/, "");
    const path = this.config.messagesPath.replace(/^\//, "");
    return `${root}/${path}`;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": this.config.version,
      ...(this.config.defaultHeaders ?? {}),
    };
    if (this.config.apiKey) {
      headers["x-api-key"] = this.config.apiKey;
    }
    return headers;
  }

  private buildBody(
    request: ModelRequest,
    stream: boolean,
  ): Record<string, unknown> {
    const { system, messages } = this.mapMessages(request.messages);
    const maxTokens =
      request.maximumOutputTokens ??
      this.capabilities.maximumOutputTokens;
    const caching = this.capabilities.supportsPromptCaching;

    const body: Record<string, unknown> = {
      model: request.model ?? this.config.model,
      max_tokens: maxTokens,
      messages: caching ? this.markMessageCacheBreakpoint(messages) : messages,
      stream,
      temperature:
        request.temperature ?? MODEL_GATEWAY_DEFAULTS.TEMPERATURE,
    };

    if (system) {
      // The system prompt and tool definitions are identical on every turn
      // of a run — caching them (plus the message-history breakpoint below)
      // is what turns a long tool-calling loop from N full-price prompt
      // reprocessings into 1 cache write + N-1 cheap cache reads.
      body.system = caching
        ? [
            {
              type: "text",
              text: system,
              cache_control: { type: "ephemeral" },
            },
          ]
        : system;
    }

    if (
      this.capabilities.supportsTools &&
      request.tools &&
      request.tools.length > 0
    ) {
      const tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
      body.tools = caching ? this.markLastCacheBreakpoint(tools) : tools;
      body.tool_choice = this.mapToolChoice(request.toolChoice);
    }

    if (request.reasoning?.enabled && request.reasoning.effort !== "none") {
      const budget =
        ANTHROPIC_DEFAULTS.REASONING_BUDGET_TOKENS[request.reasoning.effort];
      const thinkingBudget = Math.min(budget, Math.max(1, maxTokens - 1));
      body.thinking = {
        type: "enabled",
        budget_tokens: thinkingBudget,
      };
    }

    return body;
  }

  /**
   * Returns a copy of `items` with `cache_control: {type:"ephemeral"}`
   * added to the last entry. Anthropic caches everything up to and
   * including a marked entry, so one trailing breakpoint per array is
   * enough — used for both the tool-definition list and, via
   * {@link markMessageCacheBreakpoint}, a message's content blocks.
   */
  private markLastCacheBreakpoint<T extends Record<string, unknown>>(
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
  private markMessageCacheBreakpoint(
    messages: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    if (messages.length === 0) return messages;
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex] as { content: unknown };
    if (!Array.isArray(last.content) || last.content.length === 0) {
      return messages;
    }
    const updatedContent = this.markLastCacheBreakpoint(
      last.content as Array<Record<string, unknown>>,
    );
    const updatedMessages = [...messages];
    updatedMessages[lastIndex] = { ...last, content: updatedContent };
    return updatedMessages;
  }

  private mapToolChoice(
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

  private mapMessages(messages: readonly ModelMessage[]): {
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
          content: this.assistantContent(message),
        });
        continue;
      }

      conversation.push({
        role: "user",
        content: this.userContent(message),
      });
    }

    flushToolResults();

    const merged = this.mergeConsecutive(conversation);
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

  private userContent(message: ModelMessage): unknown[] {
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

  private assistantContent(message: ModelMessage): unknown[] {
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

  private mergeConsecutive(
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

  private async *yieldNonStreaming(
    response: Response,
  ): AsyncIterable<ModelEvent> {
    const json = (await response.json()) as AnthropicMessageResponse;
    yield* this.eventsFromContent(json.content ?? [], json.stop_reason);
    const usage = this.mapUsage(json.usage);
    if (usage) {
      yield { type: "usage", usage };
    }
    yield {
      type: "completed",
      finishReason: this.mapStopReason(json.stop_reason),
      ...(usage ? { usage } : {}),
    };
  }

  private async *yieldStreaming(
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
          finishReason = this.mapStopReason(payload.delta.stop_reason);
        }
        const nextUsage = this.mapUsage(payload.usage);
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

  private *eventsFromContent(
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

  private mapUsage(usage?: {
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

  private mapStopReason(reason: string | null | undefined): ModelFinishReason {
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

  private mapHttpError(
    status: number,
    body: string,
    headers?: Headers,
  ): ModelError {
    return mapHttpStatusError({
      status,
      body,
      headers,
      modelId: this.config.model,
    });
  }
}
