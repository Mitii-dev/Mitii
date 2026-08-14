import type {
  ModelErrorCode,
  ModelReasoningEffort,
  ModelToolChoice,
} from "./contracts/types";

export const MODEL_GATEWAY_IDS = {
  CAPABILITY_RESOLVER:
    "model-capability-resolver",
  ECHO_PORT:
    "echo",
  OPENAI_COMPATIBLE_PORT:
    "openai-compatible",
  ANTHROPIC_PORT:
    "anthropic",
  GEMINI_PORT:
    "gemini",
} as const;

/**
 * Explicit provider support matrix for shipped adapters.
 * Only list providers that have a working adapter path.
 */
export const MODEL_PROVIDER_SUPPORT = {
  echo: {
    status: "supported",
    adapter: "EchoLlmPort",
    notes: "Deterministic offline/test adapter.",
  },
  openai: {
    status: "supported",
    adapter: "OpenAiCompatibleLlmPort",
    notes: "Use OpenAiCompatibleLlmPort with https://api.openai.com/v1.",
  },
  ollama: {
    status: "supported",
    adapter: "OpenAiCompatibleLlmPort",
    notes: "Default OpenAiCompatibleLlmPort base URL targets Ollama.",
  },
  "openai-compatible": {
    status: "supported",
    adapter: "OpenAiCompatibleLlmPort",
    notes: "Generic OpenAI-compatible chat completions.",
  },
  openrouter: {
    status: "supported",
    adapter: "OpenAiCompatibleLlmPort",
    notes: "OpenAiCompatibleLlmPort with https://openrouter.ai/api/v1.",
  },
  deepseek: {
    status: "supported",
    adapter: "OpenAiCompatibleLlmPort",
    notes: "OpenAiCompatibleLlmPort with https://api.deepseek.com/v1.",
  },
  "lm-studio": {
    status: "supported",
    adapter: "OpenAiCompatibleLlmPort",
    notes: "OpenAiCompatibleLlmPort with http://localhost:1234/v1.",
  },
  "azure-openai": {
    status: "supported",
    adapter: "OpenAiCompatibleLlmPort",
    notes:
      "OpenAiCompatibleLlmPort with authHeader api-key and Azure deployment path.",
  },
  anthropic: {
    status: "supported",
    adapter: "AnthropicLlmPort",
    notes: "Native Anthropic Messages API (Claude).",
  },
  gemini: {
    status: "supported",
    adapter: "GeminiLlmPort",
    notes: "Native Google Gemini generateContent API.",
  },
} as const;

export type ModelProviderId = keyof typeof MODEL_PROVIDER_SUPPORT;

export const MODEL_TOOL_CHOICES = [
  "auto",
  "none",
  "required",
] as const satisfies
  readonly ModelToolChoice[];

export const MODEL_REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
] as const satisfies
  readonly ModelReasoningEffort[];

export const MODEL_ERROR_CODES = [
  "rate_limited",
  "context_length_exceeded",
  "authentication_failed",
  "invalid_request",
  "provider_unavailable",
  "content_filtered",
  "cancelled",
  "unknown",
] as const satisfies
  readonly ModelErrorCode[];

export const MODEL_GATEWAY_DEFAULTS = {
  MAXIMUM_OUTPUT_CONTEXT_RATIO:
    0.25,
  SUPPORTS_STREAMING:
    true,
  SUPPORTS_TOOLS:
    false,
  SUPPORTS_PARALLEL_TOOL_CALLS:
    false,
  SUPPORTS_STRUCTURED_OUTPUT:
    false,
  SUPPORTS_VISION:
    false,
  SUPPORTS_REASONING:
    false,
  SUPPORTS_PROMPT_CACHING:
    false,
  SUPPORTS_EMBEDDINGS:
    false,
  TEMPERATURE:
    0.2,
} as const;

export const MODEL_GATEWAY_LIMITS = {
  MINIMUM_CONTEXT_WINDOW_TOKENS:
    1_024,
  MAXIMUM_CONTEXT_WINDOW_TOKENS:
    10_000_000,
  MINIMUM_OUTPUT_TOKENS:
    1,
  MAXIMUM_OUTPUT_TOKENS:
    1_000_000,
  MAXIMUM_MESSAGES:
    10_000,
  MAXIMUM_MESSAGE_CHARACTERS:
    2_000_000,
  MAXIMUM_TOOLS:
    1_000,
  MAXIMUM_TOOL_SCHEMA_CHARACTERS:
    2_000_000,
  MAXIMUM_TEMPERATURE:
    2,
  MAXIMUM_RETRY_AFTER_MS:
    24 * 60 * 60 * 1_000,
  ERROR_BODY_PREVIEW_CHARACTERS:
    200,
  ECHO_CHUNK_CHARACTERS:
    4,
  APPROXIMATE_CHARS_PER_TOKEN:
    4,
} as const;

export const MODEL_GATEWAY_PATTERNS = {
  MODEL_ID:
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
} as const;

export const MODEL_GATEWAY_MESSAGES = {
  OUTPUT_EXCEEDS_CONTEXT:
    "maximumOutputTokens cannot exceed contextWindowTokens.",
  PARALLEL_TOOLS_REQUIRE_TOOLS:
    "Parallel tool calls require tool support.",
  TOOL_CHOICE_REQUIRES_TOOLS:
    "A tool choice other than none requires at least one tool definition.",
  TOOL_RESULT_REQUIRES_CALL_ID:
    "A tool-result message requires toolCallId.",
  JSON_SCHEMA_REQUIRES_CAPABILITY:
    "JSON schema output requires structured-output model capability.",
  EMPTY_RESPONSE_BODY:
    "Empty response body from provider.",
  AUTHENTICATION_FAILED:
    "Authentication failed. Check your API key.",
  MODEL_NOT_FOUND:
    "Model not found.",
} as const;

export const OPENAI_COMPATIBLE_DEFAULTS = {
  BASE_URL:
    "http://localhost:11434/v1",
  CHAT_COMPLETIONS_PATH:
    "chat/completions",
  AUTH_HEADER:
    "authorization" as const,
  CONTEXT_WINDOW_TOKENS:
    32_768,
  MAX_RETRIES: 2,
  INITIAL_BACKOFF_MS: 250,
  MAX_BACKOFF_MS: 8_000,
} as const;

export const ANTHROPIC_DEFAULTS = {
  BASE_URL:
    "https://api.anthropic.com",
  MESSAGES_PATH:
    "v1/messages",
  VERSION:
    "2023-06-01",
  MODEL:
    "claude-sonnet-4-5",
  CONTEXT_WINDOW_TOKENS:
    200_000,
  MAXIMUM_OUTPUT_TOKENS:
    16_384,
  MAX_RETRIES: 2,
  INITIAL_BACKOFF_MS: 250,
  MAX_BACKOFF_MS: 8_000,
  REASONING_BUDGET_TOKENS: {
    low: 1_024,
    medium: 4_096,
    high: 10_240,
  },
} as const;

export const GEMINI_DEFAULTS = {
  BASE_URL:
    "https://generativelanguage.googleapis.com",
  API_VERSION:
    "v1beta",
  MODEL:
    "gemini-2.5-flash",
  CONTEXT_WINDOW_TOKENS:
    1_048_576,
  MAXIMUM_OUTPUT_TOKENS:
    8_192,
  MAX_RETRIES: 2,
  INITIAL_BACKOFF_MS: 250,
  MAX_BACKOFF_MS: 8_000,
} as const;

export const HTTP_STATUS_TO_MODEL_ERROR: Readonly<
  Record<number, ModelErrorCode>
> = {
  400: "invalid_request",
  401: "authentication_failed",
  403: "authentication_failed",
  404: "invalid_request",
  408: "provider_unavailable",
  429: "rate_limited",
  500: "provider_unavailable",
  502: "provider_unavailable",
  503: "provider_unavailable",
  504: "provider_unavailable",
};
