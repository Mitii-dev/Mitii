import {
  MODEL_GATEWAY_DEFAULTS,
  MODEL_GATEWAY_IDS,
} from "./constants";

import {
  modelCapabilitiesSchema,
} from "./contracts/schema";

import type {
  ModelCapabilities,
  ResolveModelCapabilitiesInput,
} from "./contracts/types";

export class ModelCapabilityResolver {
  public readonly id =
    MODEL_GATEWAY_IDS
      .CAPABILITY_RESOLVER;

  public resolve(
    input:
      ResolveModelCapabilitiesInput,
  ): ModelCapabilities {
    const result:
      ModelCapabilities = {
      modelId:
        input.modelId
          .trim(),
      contextWindowTokens:
        input
          .contextWindowTokens,
      maximumOutputTokens:
        input
          .maximumOutputTokens ??
        Math.min(
          MODEL_GATEWAY_DEFAULTS
            .MAXIMUM_OUTPUT_TOKENS,
          input
            .contextWindowTokens,
        ),
      supportsStreaming:
        input
          .supportsStreaming ??
        MODEL_GATEWAY_DEFAULTS
          .SUPPORTS_STREAMING,
      supportsTools:
        input
          .supportsTools ??
        MODEL_GATEWAY_DEFAULTS
          .SUPPORTS_TOOLS,
      supportsParallelToolCalls:
        input
          .supportsParallelToolCalls ??
        MODEL_GATEWAY_DEFAULTS
          .SUPPORTS_PARALLEL_TOOL_CALLS,
      supportsStructuredOutput:
        input
          .supportsStructuredOutput ??
        MODEL_GATEWAY_DEFAULTS
          .SUPPORTS_STRUCTURED_OUTPUT,
      supportsVision:
        input
          .supportsVision ??
        MODEL_GATEWAY_DEFAULTS
          .SUPPORTS_VISION,
      supportsReasoning:
        input
          .supportsReasoning ??
        MODEL_GATEWAY_DEFAULTS
          .SUPPORTS_REASONING,
      supportsPromptCaching:
        input
          .supportsPromptCaching ??
        MODEL_GATEWAY_DEFAULTS
          .SUPPORTS_PROMPT_CACHING,
      supportsEmbeddings:
        input
          .supportsEmbeddings ??
        MODEL_GATEWAY_DEFAULTS
          .SUPPORTS_EMBEDDINGS,
      ...(input.agenticTier
        ? {
            agenticTier:
              input
                .agenticTier,
          }
        : {}),
    };

    return modelCapabilitiesSchema
      .parse(
        result,
      ) as ModelCapabilities;
  }
}
