export type ModelMessageRole =
  | "system"
  | "user"
  | "assistant"
  | "tool";

export interface ModelImageAttachment {
  kind: "image";
  mimeType: string;
  data: string;
  name?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;

  name?: string;

  /**
   * Required on role:"tool" messages. It identifies the tool call
   * whose result is contained in content.
   */
  toolCallId?: string;

  toolCalls?: readonly ModelToolCall[];
  attachments?: readonly ModelImageAttachment[];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

export type ModelToolChoice =
  | "auto"
  | "none"
  | "required";

export type ModelReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high";

export interface ModelReasoningOptions {
  enabled: boolean;
  effort: ModelReasoningEffort;
  includeInResponse: boolean;
}

export type ModelResponseFormat =
  | {
      type: "text";
    }
  | {
      type: "json_object";
    }
  | {
      type: "json_schema";
      name: string;
      schema: Readonly<
        Record<
          string,
          unknown
        >
      >;
      strict?: boolean;
    };

export interface ModelRequest {
  messages: readonly ModelMessage[];

  model?: string;
  temperature?: number;
  maximumOutputTokens?: number;
  stream?: boolean;

  tools?: readonly ModelToolDefinition[];
  toolChoice?: ModelToolChoice;

  reasoning?: ModelReasoningOptions;
  responseFormat?: ModelResponseFormat;
}

export type ModelFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "cancelled"
  | "error"
  | "unknown";

export interface ModelToolCallDelta {
  /**
   * Zero-based position of this tool call within the assistant turn.
   * The provider ID becomes the stable identity once it is emitted.
   */
  index: number;

  id?: string;
  name?: string;
  arguments?: string;
}

export interface ModelTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Prefix tokens served from provider cache (DeepSeek hit, Anthropic cache_read). */
  cacheHitTokens?: number;
  /** Prompt tokens billed at full input rate. */
  cacheMissTokens?: number;
}

export type ModelErrorCode =
  | "rate_limited"
  | "context_length_exceeded"
  | "authentication_failed"
  | "invalid_request"
  | "provider_unavailable"
  | "content_filtered"
  | "cancelled"
  | "unknown";

export interface ModelError {
  code: ModelErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  providerCode?: string;
}

export type ModelEvent =
  | {
      type: "content_delta";
      content: string;
    }
  | {
      type: "reasoning_delta";
      reasoning: string;
    }
  | {
      type: "tool_call_delta";
      toolCalls: readonly ModelToolCallDelta[];
    }
  | {
      type: "usage";
      usage: ModelTokenUsage;
    }
  | {
      type: "completed";
      finishReason: ModelFinishReason;
      usage?: ModelTokenUsage;
    }
  | {
      type: "failed";
      error: ModelError;
      finishReason?: ModelFinishReason;
    }
  | {
      type: "cancelled";
      error: ModelError;
    };

/** @deprecated Use ModelEvent. Kept briefly for mechanical import repairs. */
export type ModelResponseDelta = ModelEvent;

export type ModelAgenticTier =
  | "basic"
  | "standard"
  | "advanced";

export interface ModelCapabilities {
  modelId: string;

  contextWindowTokens: number;
  maximumOutputTokens: number;

  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsParallelToolCalls: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsPromptCaching: boolean;
  supportsEmbeddings: boolean;

  agenticTier?: ModelAgenticTier;
}

export interface ResolveModelCapabilitiesInput {
  modelId: string;

  contextWindowTokens: number;
  maximumOutputTokens?: number;

  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsParallelToolCalls?: boolean;
  supportsStructuredOutput?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsPromptCaching?: boolean;
  supportsEmbeddings?: boolean;

  agenticTier?: ModelAgenticTier;
}

export interface ModelCallContext {
  runId?: string;
  requestId?: string;
  abortSignal?: AbortSignal;
}

/**
 * Provider-neutral model boundary.
 *
 * When countTokens is absent, prompt budgeting must use an injected
 * TokenEstimatorPort. The model gateway never guesses token counts.
 */
export interface LlmPort {
  readonly id: string;
  readonly capabilities: ModelCapabilities;

  complete(
    request: ModelRequest,
    context?: ModelCallContext,
  ): AsyncIterable<ModelEvent>;

  countTokens?(
    text: string,
    context?: ModelCallContext,
  ): Promise<number>;
}
