import type {
  ModelErrorCode,
  ModelReasoningEffort,
  ModelToolChoice,
} from "./types";

export const MODEL_GATEWAY_IDS = {
  CAPABILITY_RESOLVER:
    "model-capability-resolver",
} as const;

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
  MAXIMUM_OUTPUT_TOKENS:
    4_096,
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
} as const;
