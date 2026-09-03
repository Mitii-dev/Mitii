import {
  WINDOW_BUDGET_BAND_CEILINGS,
  resolveWindowBudgetBand,
  type WindowBudgetBand,
} from "../../window-budget";

/**
 * Intent-classifier output ceilings by window band (compact / standard / wide).
 * Kept well below the main agent loop budget — classification is JSON-only —
 * but high enough that long `taskHints` (many file targets) do not truncate.
 */
export const INTENT_CLASSIFIER_MAXIMUM_OUTPUT_TOKENS_BY_BAND: Record<
  WindowBudgetBand,
  number
> = {
  /** compact / "easy" windows (&lt; 50k) */
  compact: 2_048,
  /** standard windows (50k – &lt; 100k), e.g. 64k */
  standard: 4_096,
  /** wide windows (≥ 100k) */
  wide: 8_192,
} as const;

/**
 * Resolve intent-classifier `maximumOutputTokens` from the provider context
 * window (same compact/standard/wide cutoffs as Window Budget).
 */
export function resolveIntentClassifierMaximumOutputTokens(
  contextWindowTokens: number,
  providerMaximumOutputTokens?: number,
): number {
  const band = resolveWindowBudgetBand(contextWindowTokens);
  const tokens = INTENT_CLASSIFIER_MAXIMUM_OUTPUT_TOKENS_BY_BAND[band];

  // Never exceed the host/provider advertised generation ceiling when set.
  // Do not apply the 512 floor after clamping — that would re-exceed a
  // smaller provider max (e.g. band 2048 → clamp 256 → floor 512).
  if (
    typeof providerMaximumOutputTokens === "number" &&
    Number.isFinite(providerMaximumOutputTokens) &&
    providerMaximumOutputTokens > 0
  ) {
    return Math.max(1, Math.min(tokens, Math.floor(providerMaximumOutputTokens)));
  }

  // Keep a floor so unclassified hosts still allow a minimal JSON object.
  return Math.max(512, tokens);
}

export function intentClassifierBandForWindow(
  contextWindowTokens: number,
): WindowBudgetBand {
  return resolveWindowBudgetBand(contextWindowTokens);
}

/** Re-export ceilings so tests can assert band boundaries without drift. */
export { WINDOW_BUDGET_BAND_CEILINGS };
