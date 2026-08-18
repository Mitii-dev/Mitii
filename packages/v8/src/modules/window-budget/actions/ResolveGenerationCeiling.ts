import {
  LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS,
  WINDOW_BUDGET_SCHEMA_VERSION,
} from "../constants";
import type { WindowBudgetReasonCode } from "../contracts";
import { deriveWindowPolicy } from "./DeriveWindowPolicy";

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
  if (params.reasonCodes?.includes("output_host_override")) {
    return Math.min(configured, windowCap);
  }
  if (
    params.reasonCodes?.includes("output_derived_from_window") ||
    params.reasonCodes?.includes("output_legacy_default_ignored")
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
