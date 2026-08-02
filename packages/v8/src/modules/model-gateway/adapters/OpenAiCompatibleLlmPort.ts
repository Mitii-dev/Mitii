import {
  HTTP_STATUS_TO_MODEL_ERROR,
  MODEL_GATEWAY_DEFAULTS,
  MODEL_GATEWAY_IDS,
  MODEL_GATEWAY_LIMITS,
  MODEL_GATEWAY_MESSAGES,
  OPENAI_COMPATIBLE_DEFAULTS,
} from "../constants";
import { ModelCapabilityResolver } from "../ModelCapabilityResolver";
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

export type OpenAiCompatibleAuthHeader =
  | "authorization"
  | "api-key"
  | "x-api-key";

export interface OpenAiCompatibleLlmPortConfig {
  baseUrl?: string;
  model: string;
  apiKey?: string;
  providerId?: string;
  authHeader?: OpenAiCompatibleAuthHeader;
  chatCompletionsPath?: string;
  queryParams?: Readonly<Record<string, string>>;
  defaultHeaders?: Readonly<Record<string, string>>;
  capabilities?: Partial<
    Omit<ResolveModelCapabilitiesInput, "modelId" | "contextWindowTokens">
  > & {
    contextWindowTokens?: number;
  };
  fetchImpl?: typeof fetch;
  /**
   * Extra attempts after the first failure for retryable provider errors
   * (429 / 5xx / network). Defaults to 2 (3 total attempts).
   */
  maxRetries?: number;
  /** Initial backoff delay in ms. Doubled after each retry. Defaults to 250. */
  initialBackoffMs?: number;
  /** Cap for exponential backoff in ms. Defaults to 8_000. */
  maxBackoffMs?: number;
  /** Test seam for backoff waits. Defaults to setTimeout. */
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface OpenAiChatCompletionResponse {
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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAiChatCompletionChunk {
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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * OpenAI-compatible chat-completions adapter implementing LlmPort.
 *
 * Works with OpenAI, Ollama, vLLM, OpenRouter, DeepSeek, Azure-style
 * deployments (via authHeader + path overrides), and similar endpoints.
 */
export class OpenAiCompatibleLlmPort implements LlmPort {
  public readonly id: string;
  public readonly capabilities: ModelCapabilities;

  private readonly config: Required<
    Pick<
      OpenAiCompatibleLlmPortConfig,
      "baseUrl" | "model" | "authHeader" | "chatCompletionsPath"
    >
  > &
    OpenAiCompatibleLlmPortConfig;

  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleepImpl: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  constructor(config: OpenAiCompatibleLlmPortConfig) {
    this.config = {
      ...config,
      baseUrl:
        config.baseUrl ?? OPENAI_COMPATIBLE_DEFAULTS.BASE_URL,
      model: config.model,
      authHeader:
        config.authHeader ?? OPENAI_COMPATIBLE_DEFAULTS.AUTH_HEADER,
      chatCompletionsPath:
        config.chatCompletionsPath ??
        OPENAI_COMPATIBLE_DEFAULTS.CHAT_COMPLETIONS_PATH,
    };

    this.id =
      config.providerId ?? MODEL_GATEWAY_IDS.OPENAI_COMPATIBLE_PORT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = normalizeNonNegativeInteger(
      config.maxRetries,
      OPENAI_COMPATIBLE_DEFAULTS.MAX_RETRIES,
    );
    this.initialBackoffMs = normalizePositiveInteger(
      config.initialBackoffMs,
      OPENAI_COMPATIBLE_DEFAULTS.INITIAL_BACKOFF_MS,
    );
    this.maxBackoffMs = normalizePositiveInteger(
      config.maxBackoffMs,
      OPENAI_COMPATIBLE_DEFAULTS.MAX_BACKOFF_MS,
    );
    this.sleepImpl = config.sleepImpl ?? defaultSleep;

    this.capabilities = new ModelCapabilityResolver().resolve({
      modelId: config.model,
      contextWindowTokens:
        config.capabilities?.contextWindowTokens ??
        OPENAI_COMPATIBLE_DEFAULTS.CONTEXT_WINDOW_TOKENS,
      supportsStreaming:
        config.capabilities?.supportsStreaming ?? true,
      supportsTools: config.capabilities?.supportsTools ?? true,
      supportsParallelToolCalls:
        config.capabilities?.supportsParallelToolCalls ?? false,
      supportsStructuredOutput:
        config.capabilities?.supportsStructuredOutput ?? false,
      supportsVision: config.capabilities?.supportsVision ?? false,
      supportsReasoning:
        config.capabilities?.supportsReasoning ?? false,
      supportsPromptCaching:
        config.capabilities?.supportsPromptCaching ?? false,
      supportsEmbeddings:
        config.capabilities?.supportsEmbeddings ?? false,
      ...(config.capabilities?.agenticTier
        ? { agenticTier: config.capabilities.agenticTier }
        : {}),
      ...(config.capabilities?.maximumOutputTokens
        ? { maximumOutputTokens: config.capabilities.maximumOutputTokens }
        : {}),
    });
  }

  public async *complete(
    request: ModelRequest,
    context?: ModelCallContext,
  ): AsyncIterable<ModelEvent> {
    if (context?.abortSignal?.aborted) {
      yield this.cancelledEvent("Request was aborted before completion.");
      return;
    }

    const normalized = modelRequestSchema.parse(request);
    const stream = normalized.stream !== false;
    const url = this.buildUrl();
    const headers = this.buildHeaders();
    const body = this.buildBody(normalized, stream);
    const serializedBody = JSON.stringify(body);

    let attempt = 0;
    let lastError: ModelError | undefined;

    while (attempt <= this.maxRetries) {
      if (context?.abortSignal?.aborted) {
        yield this.cancelledEvent("Request was aborted before completion.");
        return;
      }

      let response: Response;

      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers,
          body: serializedBody,
          signal: context?.abortSignal,
        });
      } catch (error) {
        if (context?.abortSignal?.aborted) {
          yield this.cancelledEvent("Request was aborted during transport.");
          return;
        }

        lastError = this.toModelError(error);
        if (
          !lastError.retryable ||
          attempt >= this.maxRetries
        ) {
          yield {
            type: "failed",
            finishReason: "error",
            error: lastError,
          };
          return;
        }

        try {
          await this.sleepImpl(
            this.backoffDelayMs(attempt, lastError.retryAfterMs),
            context?.abortSignal,
          );
        } catch (error) {
          if (
            context?.abortSignal?.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            yield this.cancelledEvent(
              "Request was aborted during retry backoff.",
            );
            return;
          }
          throw error;
        }
        attempt += 1;
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        lastError = this.mapHttpError(
          response.status,
          text,
          response.headers,
        );
        if (
          !lastError.retryable ||
          attempt >= this.maxRetries
        ) {
          yield {
            type: "failed",
            finishReason: "error",
            error: lastError,
          };
          return;
        }

        try {
          await this.sleepImpl(
            this.backoffDelayMs(attempt, lastError.retryAfterMs),
            context?.abortSignal,
          );
        } catch (error) {
          if (
            context?.abortSignal?.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            yield this.cancelledEvent(
              "Request was aborted during retry backoff.",
            );
            return;
          }
          throw error;
        }
        attempt += 1;
        continue;
      }

      if (!stream) {
        yield* this.yieldNonStreaming(response);
        return;
      }

      if (!response.body) {
        lastError = {
          code: "provider_unavailable",
          message: MODEL_GATEWAY_MESSAGES.EMPTY_RESPONSE_BODY,
          retryable: true,
        };
        if (attempt >= this.maxRetries) {
          yield {
            type: "failed",
            finishReason: "error",
            error: lastError,
          };
          return;
        }

        try {
          await this.sleepImpl(
            this.backoffDelayMs(attempt, lastError.retryAfterMs),
            context?.abortSignal,
          );
        } catch (error) {
          if (
            context?.abortSignal?.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            yield this.cancelledEvent(
              "Request was aborted during retry backoff.",
            );
            return;
          }
          throw error;
        }
        attempt += 1;
        continue;
      }

      yield* this.yieldStreaming(response.body);
      return;
    }

    yield {
      type: "failed",
      finishReason: "error",
      error: lastError ?? {
        code: "provider_unavailable",
        message: "Provider request failed after retries.",
        retryable: true,
      },
    };
  }

  public async countTokens(text: string): Promise<number> {
    return Math.max(
      1,
      Math.ceil(
        text.length / MODEL_GATEWAY_LIMITS.APPROXIMATE_CHARS_PER_TOKEN,
      ),
    );
  }

  private buildUrl(): string {
    const root = this.config.baseUrl.replace(/\/$/, "");
    const path = this.config.chatCompletionsPath.replace(/^\//, "");
    const url = new URL(`${root}/${path}`);

    for (const [key, value] of Object.entries(
      this.config.queryParams ?? {},
    )) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.defaultHeaders ?? {}),
    };

    if (!this.config.apiKey) {
      return headers;
    }

    if (this.config.authHeader === "api-key") {
      headers["api-key"] = this.config.apiKey;
    } else if (this.config.authHeader === "x-api-key") {
      headers["x-api-key"] = this.config.apiKey;
    } else {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private buildBody(
    request: ModelRequest,
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.config.model,
      messages: request.messages.map((message) =>
        this.formatMessage(message),
      ),
      temperature:
        request.temperature ?? MODEL_GATEWAY_DEFAULTS.TEMPERATURE,
      stream,
    };

    // OpenAI-compatible streaming omits usage unless include_usage is set.
    if (stream) {
      body.stream_options = { include_usage: true };
    }

    if (request.maximumOutputTokens !== undefined) {
      body.max_tokens = request.maximumOutputTokens;
    }

    if (
      this.capabilities.supportsTools &&
      request.tools &&
      request.tools.length > 0
    ) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      body.tool_choice = request.toolChoice ?? "auto";
    }

    if (request.responseFormat) {
      if (request.responseFormat.type === "json_object") {
        body.response_format = { type: "json_object" };
      } else if (request.responseFormat.type === "json_schema") {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: request.responseFormat.name,
            schema: request.responseFormat.schema,
            strict: request.responseFormat.strict,
          },
        };
      }
    }

    if (request.reasoning?.enabled) {
      body.include_reasoning = true;
      if (request.reasoning.effort !== "none") {
        body.reasoning_effort = request.reasoning.effort;
      }
    }

    return body;
  }

  private formatMessage(
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

  private async *yieldNonStreaming(
    response: Response,
  ): AsyncIterable<ModelEvent> {
    const json =
      (await response.json()) as OpenAiChatCompletionResponse;
    const choice = json.choices?.[0];
    const message = choice?.message;

    if (message?.content) {
      yield { type: "content_delta", content: message.content };
    }

    const reasoning =
      message?.reasoning ?? message?.reasoning_content;

    if (reasoning) {
      yield { type: "reasoning_delta", reasoning };
    }

    if (message?.tool_calls) {
      const toolCalls: ModelToolCallDelta[] = message.tool_calls.map(
        (toolCall, index) => ({
          index,
          id: toolCall.id,
          name: toolCall.function?.name,
          arguments: toolCall.function?.arguments,
        }),
      );

      yield { type: "tool_call_delta", toolCalls };
    }

    const usage = json.usage
      ? {
          inputTokens: json.usage.prompt_tokens,
          outputTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        }
      : undefined;

    if (usage) {
      yield { type: "usage", usage };
    }

    yield {
      type: "completed",
      finishReason: this.mapFinishReason(choice?.finish_reason),
      ...(usage ? { usage } : {}),
    };
  }

  private async *yieldStreaming(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<ModelEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawTerminal = false;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          for (const event of this.parseSseLine(line)) {
            if (
              event.type === "completed" ||
              event.type === "failed" ||
              event.type === "cancelled"
            ) {
              if (sawTerminal) {
                continue;
              }
              sawTerminal = true;
            }
            yield event;
          }
        }
      }

      if (buffer.trim()) {
        for (const event of this.parseSseLine(buffer)) {
          if (
            event.type === "completed" ||
            event.type === "failed" ||
            event.type === "cancelled"
          ) {
            if (sawTerminal) {
              continue;
            }
            sawTerminal = true;
          }
          yield event;
        }
      }

      if (!sawTerminal) {
        yield { type: "completed", finishReason: "stop" };
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseSseLine(line: string): ModelEvent[] {
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

    const usage = chunk.usage
      ? {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        }
      : undefined;

    if (usage) {
      events.push({ type: "usage", usage });
    }

    const finishReason = choice?.finish_reason;
    if (finishReason) {
      events.push({
        type: "completed",
        finishReason: this.mapFinishReason(finishReason),
        ...(usage ? { usage } : {}),
      });
    }

    return events;
  }

  private mapFinishReason(
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

  private mapHttpError(
    status: number,
    body: string,
    headers?: Headers,
  ): ModelError {
    const code =
      HTTP_STATUS_TO_MODEL_ERROR[status] ?? "unknown";
    const preview = body
      .slice(0, MODEL_GATEWAY_LIMITS.ERROR_BODY_PREVIEW_CHARACTERS)
      .trim();
    const retryAfterMs = parseRetryAfterMs(headers);

    if (status === 401) {
      return {
        code: "authentication_failed",
        message: MODEL_GATEWAY_MESSAGES.AUTHENTICATION_FAILED,
        retryable: false,
        providerCode: String(status),
      };
    }

    if (status === 404) {
      return {
        code: "invalid_request",
        message: `${MODEL_GATEWAY_MESSAGES.MODEL_NOT_FOUND} (${this.config.model})`,
        retryable: false,
        providerCode: String(status),
      };
    }

    return {
      code,
      message: preview
        ? `Provider returned ${status}: ${preview}`
        : `Provider returned ${status}.`,
      retryable:
        code === "rate_limited" || code === "provider_unavailable",
      providerCode: String(status),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }

  private backoffDelayMs(
    attempt: number,
    retryAfterMs?: number,
  ): number {
    if (
      typeof retryAfterMs === "number" &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs > 0
    ) {
      return Math.min(
        Math.floor(retryAfterMs),
        MODEL_GATEWAY_LIMITS.MAXIMUM_RETRY_AFTER_MS,
      );
    }

    const exponential = this.initialBackoffMs * 2 ** attempt;
    const capped = Math.min(exponential, this.maxBackoffMs);
    const jitter = Math.floor(Math.random() * Math.max(1, capped * 0.2));
    return capped + jitter;
  }

  private toModelError(error: unknown): ModelError {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        code: "cancelled",
        message: "Request was aborted.",
        retryable: false,
      };
    }

    return {
      code: "provider_unavailable",
      message:
        error instanceof Error
          ? error.message
          : "Provider request failed.",
      retryable: true,
    };
  }

  private cancelledEvent(message: string): ModelEvent {
    return {
      type: "cancelled",
      error: {
        code: "cancelled",
        message,
        retryable: false,
      },
    };
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfterMs(headers?: Headers): number | undefined {
  if (!headers) return undefined;
  const raw = headers.get("retry-after");
  if (!raw?.trim()) return undefined;

  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(
      Math.floor(asSeconds * 1_000),
      MODEL_GATEWAY_LIMITS.MAXIMUM_RETRY_AFTER_MS,
    );
  }

  const asDate = Date.parse(raw);
  if (!Number.isFinite(asDate)) return undefined;
  const delta = asDate - Date.now();
  if (delta <= 0) return 0;
  return Math.min(delta, MODEL_GATEWAY_LIMITS.MAXIMUM_RETRY_AFTER_MS);
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  ) {
    return Math.floor(value);
  }
  return fallback;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return Math.floor(value);
  }
  return fallback;
}
