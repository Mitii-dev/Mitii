/**
 * Model Gateway policy tables — defaults, limits, provider matrix, HTTP maps.
 * Adapters read these; orchestration stays in pipeline/actions.
 */

export {
  MODEL_PROVIDER_SUPPORT,
  OPENAI_COMPATIBLE_PROVIDER_BASE_URLS,
  MODEL_GATEWAY_DEFAULTS,
  MODEL_GATEWAY_LIMITS,
  MODEL_GATEWAY_MESSAGES,
  MODEL_TOOL_CHOICES,
  MODEL_REASONING_EFFORTS,
  MODEL_ERROR_CODES,
  OPENAI_COMPATIBLE_DEFAULTS,
  ANTHROPIC_DEFAULTS,
  GEMINI_DEFAULTS,
  HTTP_STATUS_TO_MODEL_ERROR,
} from "../constants";
export type { ModelProviderId } from "../constants";
