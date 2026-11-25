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
  ModelRequest,
  ResolveModelCapabilitiesInput,
} from "../contracts/contracts";
import {
  approximateTokenCount,
  cancelledEvent,
  completeWithHttpRetry,
  defaultSleep,
  mapHttpStatusError,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
} from "../helpers/http";
import {
  anthropicNonStreamingEvents,
  anthropicStreamingEvents,
} from "../helpers/anthropicEvents";
import {
  mapAnthropicMessages,
  mapAnthropicToolChoice,
  markLastCacheBreakpoint,
  markMessageCacheBreakpoint,
} from "../helpers/anthropicWire";
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
  /** Per-request HTTP wall clock (ms). Pass 0 to disable. */
  requestTimeoutMs?: number;
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
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
  private readonly requestTimeoutMs: number | undefined;
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
    this.requestTimeoutMs =
      typeof config.requestTimeoutMs === "number"
        ? config.requestTimeoutMs
        : undefined;
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
      requestTimeoutMs: this.requestTimeoutMs,
      fetchImpl: this.fetchImpl,
      maxRetries: this.maxRetries,
      initialBackoffMs: this.initialBackoffMs,
      maxBackoffMs: this.maxBackoffMs,
      sleepImpl: this.sleepImpl,
      mapHttpError: (status, text, responseHeaders) =>
        this.mapHttpError(status, text, responseHeaders),
      yieldNonStreaming: (response) => anthropicNonStreamingEvents(response),
      yieldStreaming: (responseBody) => anthropicStreamingEvents(responseBody),
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
    const { system, messages } = mapAnthropicMessages(request.messages);
    const maxTokens = Math.min(
      request.maximumOutputTokens ?? this.capabilities.maximumOutputTokens,
      this.capabilities.maximumOutputTokens,
    );
    const caching = this.capabilities.supportsPromptCaching;

    const body: Record<string, unknown> = {
      model: request.model ?? this.config.model,
      max_tokens: maxTokens,
      messages: caching ? markMessageCacheBreakpoint(messages) : messages,
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
      body.tools = caching ? markLastCacheBreakpoint(tools) : tools;
      body.tool_choice = mapAnthropicToolChoice(request.toolChoice);
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
