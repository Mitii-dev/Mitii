export {
  MODEL_GATEWAY_IDS,
  MODEL_PROVIDER_SUPPORT,
  MODEL_TOOL_CHOICES,
  MODEL_REASONING_EFFORTS,
  MODEL_ERROR_CODES,
  MODEL_GATEWAY_DEFAULTS,
  MODEL_GATEWAY_LIMITS,
  MODEL_GATEWAY_PATTERNS,
  MODEL_GATEWAY_MESSAGES,
  OPENAI_COMPATIBLE_DEFAULTS,
  HTTP_STATUS_TO_MODEL_ERROR,
} from "./constants";
export type { ModelProviderId } from "./constants";

export {
  modelRequestSchema,
  modelMessageSchema,
  modelToolDefinitionSchema,
  modelErrorSchema,
  modelEventSchema,
  modelResponseDeltaSchema,
  modelCapabilitiesSchema,
} from "./contracts/schema";

export type {
  LlmPort,
  ModelRequest,
  ModelMessage,
  ModelCapabilities,
  ModelEvent,
  ModelResponseDelta,
  ModelCallContext,
  ModelError,
  ModelFinishReason,
  ModelTokenUsage,
  ModelToolCall,
  ModelToolCallDelta,
  ModelToolChoice,
  ModelToolDefinition,
  ResolveModelCapabilitiesInput,
} from "./contracts/types";

export { ModelCapabilityResolver } from "./ModelCapabilityResolver";

export {
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
} from "./adapters";
export type {
  EchoLlmPortOptions,
  OpenAiCompatibleAuthHeader,
  OpenAiCompatibleLlmPortConfig,
} from "./adapters";
