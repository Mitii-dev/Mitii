/**
 * Model Gateway public surface.
 *
 * Prefer `ModelGatewayPipeline` for capability resolve + logged complete.
 * Adapters remain the provider wire implementations.
 */

export { ModelGatewayPipeline } from "./actions/ModelGatewayPipeline";
export type { ModelGatewayPipelineDependencies } from "./actions/ModelGatewayPipeline";

export {
  MODEL_GATEWAY_IDS,
  MODEL_GATEWAY_STAGES,
  MODEL_PROVIDER_SUPPORT,
  OPENAI_COMPATIBLE_PROVIDER_BASE_URLS,
  MODEL_TOOL_CHOICES,
  MODEL_REASONING_EFFORTS,
  MODEL_ERROR_CODES,
  MODEL_GATEWAY_DEFAULTS,
  MODEL_GATEWAY_LIMITS,
  MODEL_GATEWAY_PATTERNS,
  MODEL_GATEWAY_MESSAGES,
  OPENAI_COMPATIBLE_DEFAULTS,
  ANTHROPIC_DEFAULTS,
  GEMINI_DEFAULTS,
  HTTP_STATUS_TO_MODEL_ERROR,
} from "./constants";
export type {
  ModelProviderId,
  ModelGatewayStageName,
} from "./constants";

export {
  modelRequestSchema,
  modelMessageSchema,
  modelToolDefinitionSchema,
  modelErrorSchema,
  modelEventSchema,
  modelResponseDeltaSchema,
  modelCapabilitiesSchema,
  noopModuleLogger,
} from "./types";

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
  ModuleLoggerPort,
} from "./types";

export {
  ModelCapabilityResolver,
  resolveModelCapabilities,
} from "./actions/steps";

export {
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  projectOpenAiCompatibleMessages,
  AnthropicLlmPort,
  GeminiLlmPort,
} from "./impl";
export type {
  EchoLlmPortOptions,
  OpenAiCompatibleAuthHeader,
  OpenAiCompatibleLlmPortConfig,
  AnthropicLlmPortConfig,
  GeminiLlmPortConfig,
} from "./impl";
