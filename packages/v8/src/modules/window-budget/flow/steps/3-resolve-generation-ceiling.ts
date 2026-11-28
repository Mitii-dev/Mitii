import {
  LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS,
  WINDOW_BUDGET_REASON,
  WINDOW_BUDGET_SCHEMA_VERSION,
  WINDOW_BUDGET_STAGES,
} from "../../constants";
import type { WindowBudgetReasonCode, WindowBudgetStageTrace } from "../../contracts";
import { deriveWindowPolicy } from "./2-derive-allocation";

/**
 * Hard cap for per-turn max_tokens.
 *
 * The planning reserve (outputReservedTokens / window-policy
 * maximumOutputTokens) keeps the prompt from filling the window. Generation
 * may use leftover context up to this ceiling. A real host override stays a
 * hard cap; the derived reserve and the legacy 5000 default do not.
 */
export function resolveGenerationCeiling(params: {
  contextWindowTokens: number;
  configuredOutputTokens: number;
  reasonCodes?: readonly WindowBudgetReasonCode[];
}): number {
  const windowCap = Math.max(1, Math.floor(params.contextWindowTokens) - 1);
  const configured = Math.max(1, Math.floor(params.configuredOutputTokens));
  if (params.reasonCodes?.includes(WINDOW_BUDGET_REASON.outputHostOverride)) {
    return Math.min(configured, windowCap);
  }
  if (
    params.reasonCodes?.includes(WINDOW_BUDGET_REASON.outputDerivedFromWindow) ||
    params.reasonCodes?.includes(WINDOW_BUDGET_REASON.outputLegacyDefaultIgnored)
  ) {
    return windowCap;
  }
  if (configured === LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS) {
    return windowCap;
  }
  const derived = deriveWindowPolicy({
    schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
    contextWindowTokens: Math.max(1, Math.floor(params.contextWindowTokens)),
    maximumOutputTokens: 0,
  }).maximumOutputTokens;
  if (configured === derived) {
    return windowCap;
  }
  return Math.min(configured, windowCap);
}

/** Flow step 3 wrapper with stage trace for the pipeline. */
export function resolveGenerationCeilingStep(params: {
  contextWindowTokens: number;
  configuredOutputTokens: number;
  reasonCodes?: readonly WindowBudgetReasonCode[];
}): {
  ceiling: number;
  stage: WindowBudgetStageTrace;
} {
  const startedMs = Date.now();
  const ceiling = resolveGenerationCeiling(params);
  return {
    ceiling,
    stage: {
      name: WINDOW_BUDGET_STAGES.resolveGenerationCeiling,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
    },
  };
}
