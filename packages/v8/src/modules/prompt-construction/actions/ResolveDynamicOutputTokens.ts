import type { PromptReasonCode } from "../contracts";

const DEFAULT_OUTPUT_SAFETY_MARGIN_TOKENS = 256;

export interface DynamicOutputTokenResolution {
  maximumOutputTokens: number;
  availableOutputTokens: number;
  safetyMarginTokens: number;
  reasonCodes: PromptReasonCode[];
}

/**
 * Resolve the final per-call output limit after prompt assembly.
 *
 * The early output reserve protects room for an answer while optional context is
 * selected. Once the concrete prompt is known, any unused input room can be
 * offered back to the model, bounded by the provider's advertised output cap.
 */
export function resolveDynamicOutputTokens(params: {
  contextWindowTokens: number;
  providerMaximumOutputTokens: number;
  outputReservedTokens: number;
  usedInputTokens: number;
  safetyMarginTokens?: number;
}): DynamicOutputTokenResolution {
  const contextWindowTokens = positiveInt(params.contextWindowTokens);
  const providerMaximumOutputTokens = clampInt(
    positiveInt(params.providerMaximumOutputTokens),
    1,
    Math.max(1, contextWindowTokens - 1),
  );
  const outputReservedTokens = clampInt(
    positiveInt(params.outputReservedTokens),
    1,
    providerMaximumOutputTokens,
  );
  const usedInputTokens = Math.max(0, Math.floor(params.usedInputTokens));
  const availableOutputTokens = clampInt(
    contextWindowTokens - usedInputTokens,
    1,
    Math.max(1, contextWindowTokens - 1),
  );
  const safetyMarginTokens = clampInt(
    params.safetyMarginTokens ?? DEFAULT_OUTPUT_SAFETY_MARGIN_TOKENS,
    0,
    Math.max(0, availableOutputTokens - 1),
  );

  const availableWithSafety = Math.max(
    1,
    availableOutputTokens - safetyMarginTokens,
  );
  const targetOutputTokens =
    availableOutputTokens >= outputReservedTokens
      ? Math.max(outputReservedTokens, availableWithSafety)
      : availableWithSafety;
  const maximumOutputTokens = Math.min(
    providerMaximumOutputTokens,
    targetOutputTokens,
  );

  const reasonCodes: PromptReasonCode[] = [];
  if (maximumOutputTokens > outputReservedTokens) {
    reasonCodes.push("dynamic_output_expanded");
  }
  if (maximumOutputTokens < outputReservedTokens) {
    reasonCodes.push("dynamic_output_limited_by_context");
  }
  if (providerMaximumOutputTokens < targetOutputTokens) {
    reasonCodes.push("dynamic_output_capped_by_provider");
  }

  return {
    maximumOutputTokens,
    availableOutputTokens,
    safetyMarginTokens,
    reasonCodes,
  };
}

function positiveInt(value: number): number {
  return Math.max(1, Math.floor(value));
}

function clampInt(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}
