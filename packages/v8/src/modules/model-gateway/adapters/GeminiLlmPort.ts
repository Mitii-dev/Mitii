import {
  GEMINI_DEFAULTS,
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

export interface GeminiLlmPortConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
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

interface GeminiPart {
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

interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string | null;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

/**
 * Native Google Gemini generateContent adapter.
 * Hosts inject apiKey; V8 never reads environment secrets.
 */
export class GeminiLlmPort implements LlmPort {
  public readonly id: string;
  public readonly capabilities: ModelCapabilities;

  private readonly config: Required<
    Pick<GeminiLlmPortConfig, "baseUrl" | "model" | "apiVersion">
  > &
    GeminiLlmPortConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleepImpl: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  constructor(config: GeminiLlmPortConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl ?? GEMINI_DEFAULTS.BASE_URL,
      model: config.model,
      apiVersion: config.apiVersion ?? GEMINI_DEFAULTS.API_VERSION,
    };
    this.id = config.providerId ?? MODEL_GATEWAY_IDS.GEMINI_PORT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = normalizeNonNegativeInteger(
      config.maxRetries,
      GEMINI_DEFAULTS.MAX_RETRIES,
    );
    this.initialBackoffMs = normalizePositiveInteger(
      config.initialBackoffMs,
      GEMINI_DEFAULTS.INITIAL_BACKOFF_MS,
    );
    this.maxBackoffMs = normalizePositiveInteger(
      config.maxBackoffMs,
      GEMINI_DEFAULTS.MAX_BACKOFF_MS,
    );
    this.sleepImpl = config.sleepImpl ?? defaultSleep;
    this.capabilities = new ModelCapabilityResolver().resolve({
      modelId: config.model,
      contextWindowTokens:
        config.capabilities?.contextWindowTokens ??
        GEMINI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
      maximumOutputTokens:
        config.capabilities?.maximumOutputTokens ??
        GEMINI_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
      supportsStreaming: config.capabilities?.supportsStreaming ?? true,
      supportsTools: config.capabilities?.supportsTools ?? true,
      supportsParallelToolCalls:
        config.capabilities?.supportsParallelToolCalls ?? true,
      supportsStructuredOutput:
        config.capabilities?.supportsStructuredOutput ?? true,
      supportsVision: config.capabilities?.supportsVision ?? true,
      supportsReasoning: config.capabilities?.supportsReasoning ?? true,
      supportsPromptCaching:
        config.capabilities?.supportsPromptCaching ?? false,
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
    const url = this.buildUrl(normalized.model ?? this.config.model, stream);
    const headers = this.buildHeaders();
    const body = JSON.stringify(this.buildBody(normalized));

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

  private buildUrl(model: string, stream: boolean): string {
    const root = this.config.baseUrl.replace(/\/$/, "");
    const version = this.config.apiVersion.replace(/^\//, "");
    const modelId = model.startsWith("models/")
      ? model.slice("models/".length)
      : model;
    const action = stream ? "streamGenerateContent" : "generateContent";
    const url = new URL(`${root}/${version}/models/${modelId}:${action}`);
    if (stream) {
      url.searchParams.set("alt", "sse");
    }
    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.defaultHeaders ?? {}),
    };
    if (this.config.apiKey) {
      headers["x-goog-api-key"] = this.config.apiKey;
    }
    return headers;
  }

  private buildBody(request: ModelRequest): Record<string, unknown> {
    const { systemInstruction, contents } = this.mapMessages(request.messages);
    const generationConfig: Record<string, unknown> = {
      temperature:
        request.temperature ?? MODEL_GATEWAY_DEFAULTS.TEMPERATURE,
    };
    if (request.maximumOutputTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maximumOutputTokens;
    } else {
      generationConfig.maxOutputTokens = this.capabilities.maximumOutputTokens;
    }

    if (request.responseFormat?.type === "json_object") {
      generationConfig.responseMimeType = "application/json";
    } else if (request.responseFormat?.type === "json_schema") {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = request.responseFormat.schema;
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (
      this.capabilities.supportsTools &&
      request.tools &&
      request.tools.length > 0
    ) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
        },
      ];
      body.toolConfig = {
        functionCallingConfig: {
          mode:
            request.toolChoice === "none"
              ? "NONE"
              : request.toolChoice === "required"
                ? "ANY"
                : "AUTO",
        },
      };
    }

    return body;
  }

  private mapMessages(messages: readonly ModelMessage[]): {
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
            response: this.toolResponseObject(message.content),
          },
        });
        continue;
      }

      flushTools();

      if (message.role === "assistant") {
        contents.push({
          role: "model",
          parts: this.assistantParts(message),
        });
        continue;
      }

      contents.push({
        role: "user",
        parts: this.userParts(message),
      });
    }

    flushTools();

    const merged = this.mergeConsecutive(contents);
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

  private userParts(message: ModelMessage): GeminiPart[] {
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

  private assistantParts(message: ModelMessage): GeminiPart[] {
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

  private toolResponseObject(content: string): Record<string, unknown> {
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

  private mergeConsecutive(
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

  private async *yieldNonStreaming(
    response: Response,
  ): AsyncIterable<ModelEvent> {
    const json = (await response.json()) as GeminiResponse;
    if (json.promptFeedback?.blockReason) {
      yield {
        type: "failed",
        finishReason: "content_filter",
        error: {
          code: "content_filtered",
          message: `Gemini blocked the prompt (${json.promptFeedback.blockReason}).`,
          retryable: false,
          providerCode: json.promptFeedback.blockReason,
        },
      };
      return;
    }

    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    yield* this.eventsFromParts(parts);
    const usage = this.mapUsage(json.usageMetadata);
    if (usage) {
      yield { type: "usage", usage };
    }
    yield {
      type: "completed",
      finishReason: this.mapFinishReason(
        candidate?.finishReason,
        parts,
      ),
      ...(usage ? { usage } : {}),
    };
  }

  private async *yieldStreaming(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<ModelEvent> {
    let usage:
      | {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        }
      | undefined;
    let finishReason: ModelFinishReason | undefined;
    let sawTerminal = false;
    let toolIndex = 0;

    for await (const event of iterateSseEvents(body)) {
      if (!event.data || event.data === "[DONE]") {
        if (event.data === "[DONE]" && !sawTerminal) {
          sawTerminal = true;
          yield {
            type: "completed",
            finishReason: finishReason ?? "stop",
            ...(usage ? { usage } : {}),
          };
        }
        continue;
      }

      let payload: GeminiResponse;
      try {
        payload = JSON.parse(event.data) as GeminiResponse;
      } catch {
        continue;
      }

      if (payload.promptFeedback?.blockReason && !sawTerminal) {
        sawTerminal = true;
        yield {
          type: "failed",
          finishReason: "content_filter",
          error: {
            code: "content_filtered",
            message: `Gemini blocked the prompt (${payload.promptFeedback.blockReason}).`,
            retryable: false,
            providerCode: payload.promptFeedback.blockReason,
          },
        };
        continue;
      }

      const candidate = payload.candidates?.[0];
      for (const modelEvent of this.eventsFromParts(
        candidate?.content?.parts ?? [],
        toolIndex,
      )) {
        if (modelEvent.type === "tool_call_delta") {
          toolIndex += modelEvent.toolCalls.length;
        }
        yield modelEvent;
      }

      const nextUsage = this.mapUsage(payload.usageMetadata);
      if (nextUsage) {
        usage = nextUsage;
        yield { type: "usage", usage };
      }

      if (candidate?.finishReason) {
        finishReason = this.mapFinishReason(
          candidate.finishReason,
          candidate.content?.parts,
        );
        if (!sawTerminal) {
          sawTerminal = true;
          yield {
            type: "completed",
            finishReason,
            ...(usage ? { usage } : {}),
          };
        }
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

  private *eventsFromParts(
    parts: GeminiPart[],
    toolIndexStart = 0,
  ): Iterable<ModelEvent> {
    const toolCalls: ModelToolCallDelta[] = [];
    let toolOffset = 0;
    for (const part of parts) {
      if (part.thought && part.text) {
        yield { type: "reasoning_delta", reasoning: part.text };
        continue;
      }
      if (part.text) {
        yield { type: "content_delta", content: part.text };
      }
      if (part.functionCall?.name) {
        const thoughtSignature = this.readThoughtSignature(part);
        toolCalls.push({
          index: toolIndexStart + toolOffset,
          id: `call_${toolIndexStart + toolOffset}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
          ...(thoughtSignature ? { thoughtSignature } : {}),
        });
        toolOffset += 1;
      }
    }
    if (toolCalls.length > 0) {
      yield { type: "tool_call_delta", toolCalls };
    }
  }

  private readThoughtSignature(part: GeminiPart): string | undefined {
    const value = part.thoughtSignature ?? part.thought_signature;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private mapUsage(usage?: {
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

  private mapFinishReason(
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
