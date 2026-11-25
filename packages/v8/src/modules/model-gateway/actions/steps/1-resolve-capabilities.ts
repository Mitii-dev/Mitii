import {
  MODEL_GATEWAY_DEFAULTS,
  MODEL_GATEWAY_IDS,
  MODEL_GATEWAY_LIMITS,
} from "../../constants";
import { modelCapabilitiesSchema } from "../../types/schema";
import type {
  ModelCapabilities,
  ResolveModelCapabilitiesInput,
} from "../../types/types";

/**
 * Flow step 1: fill capability defaults and validate the provider-neutral contract.
 */
export function resolveModelCapabilities(
  input: ResolveModelCapabilitiesInput,
): ModelCapabilities {
  const result: ModelCapabilities = {
    modelId: input.modelId.trim(),
    contextWindowTokens: input.contextWindowTokens,
    maximumOutputTokens:
      input.maximumOutputTokens ??
      deriveDefaultMaximumOutputTokens(input.contextWindowTokens),
    supportsStreaming:
      input.supportsStreaming ?? MODEL_GATEWAY_DEFAULTS.SUPPORTS_STREAMING,
    supportsTools:
      input.supportsTools ?? MODEL_GATEWAY_DEFAULTS.SUPPORTS_TOOLS,
    supportsParallelToolCalls:
      input.supportsParallelToolCalls ??
      MODEL_GATEWAY_DEFAULTS.SUPPORTS_PARALLEL_TOOL_CALLS,
    supportsStructuredOutput:
      input.supportsStructuredOutput ??
      MODEL_GATEWAY_DEFAULTS.SUPPORTS_STRUCTURED_OUTPUT,
    supportsVision:
      input.supportsVision ?? MODEL_GATEWAY_DEFAULTS.SUPPORTS_VISION,
    supportsReasoning:
      input.supportsReasoning ?? MODEL_GATEWAY_DEFAULTS.SUPPORTS_REASONING,
    supportsPromptCaching:
      input.supportsPromptCaching ??
      MODEL_GATEWAY_DEFAULTS.SUPPORTS_PROMPT_CACHING,
    supportsEmbeddings:
      input.supportsEmbeddings ?? MODEL_GATEWAY_DEFAULTS.SUPPORTS_EMBEDDINGS,
    supportsForcedToolChoice:
      input.supportsForcedToolChoice ??
      MODEL_GATEWAY_DEFAULTS.SUPPORTS_FORCED_TOOL_CHOICE,
    ...(input.agenticTier ? { agenticTier: input.agenticTier } : {}),
  };

  return modelCapabilitiesSchema.parse(result) as ModelCapabilities;
}

function deriveDefaultMaximumOutputTokens(
  contextWindowTokens: number,
): number {
  return Math.min(
    contextWindowTokens,
    Math.max(
      MODEL_GATEWAY_LIMITS.MINIMUM_OUTPUT_TOKENS,
      Math.floor(
        contextWindowTokens *
          MODEL_GATEWAY_DEFAULTS.MAXIMUM_OUTPUT_CONTEXT_RATIO,
      ),
    ),
  );
}

/** Class facade kept for existing adapter construction sites. */
export class ModelCapabilityResolver {
  public readonly id = MODEL_GATEWAY_IDS.CAPABILITY_RESOLVER;

  public resolve(input: ResolveModelCapabilitiesInput): ModelCapabilities {
    return resolveModelCapabilities(input);
  }
}
