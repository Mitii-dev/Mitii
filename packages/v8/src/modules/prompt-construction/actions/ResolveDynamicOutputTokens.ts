import type { PromptReasonCode } from "../contracts";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";

export interface DynamicOutputTokenResolution {
  maximumOutputTokens: number;
  availableOutputTokens: number;
  dynamicOutputRatio: number;
  reasonCodes: PromptReasonCode[];
}

/**
 * Resolve the final per-call output limit after prompt assembly.
 *
 * The early output reserve protects room for an answer while optional context is
 * selected. Once the concrete prompt is known, any unused input room can be
 * offered back to the model. The configured output value is treated as the
 * reserved baseline, not as a hard ceiling, because several local and
 * OpenAI-compatible providers can use more output when the prompt is smaller
 * than expected.
 */
export function resolveDynamicOutputTokens(params: {
  contextWindowTokens: number;
  configuredOutputTokens: number;
  outputReservedTokens: number;
  usedInputTokens: number;
  dynamicOutputRatio?: number;
}): DynamicOutputTokenResolution {
  const contextWindowTokens = positiveInt(params.contextWindowTokens);
  const configuredOutputTokens = clampInt(
    positiveInt(params.configuredOutputTokens),
    1,
    Math.max(1, contextWindowTokens - 1),
  );
  const outputReservedTokens = clampInt(
    positiveInt(params.outputReservedTokens),
    1,
    Math.max(1, contextWindowTokens - 1),
  );
  const usedInputTokens = Math.max(0, Math.floor(params.usedInputTokens));
  const availableOutputTokens = clampInt(
    contextWindowTokens - usedInputTokens,
    1,
    Math.max(1, contextWindowTokens - 1),
  );
  const dynamicOutputRatio = clampRatio(
    params.dynamicOutputRatio ??
      PROMPT_CONSTRUCTION_THRESHOLDS.dynamicOutputWindowRatio,
  );
  const scaledAvailableOutputTokens = Math.max(
    1,
    Math.floor(availableOutputTokens * dynamicOutputRatio),
  );

  const targetOutputTokens =
    availableOutputTokens >= outputReservedTokens
      ? Math.max(
          configuredOutputTokens,
          outputReservedTokens,
          scaledAvailableOutputTokens,
        )
      : scaledAvailableOutputTokens;
  const maximumOutputTokens = clampInt(
    targetOutputTokens,
    1,
    Math.max(1, availableOutputTokens),
  );

  const reasonCodes: PromptReasonCode[] = [];
  if (maximumOutputTokens > outputReservedTokens) {
    reasonCodes.push("dynamic_output_expanded");
  }
  if (maximumOutputTokens < outputReservedTokens) {
    reasonCodes.push("dynamic_output_limited_by_context");
  }

  return {
    maximumOutputTokens,
    availableOutputTokens,
    dynamicOutputRatio,
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

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return PROMPT_CONSTRUCTION_THRESHOLDS.dynamicOutputWindowRatio;
  }
  return Math.min(1, Math.max(0.01, value));
}
