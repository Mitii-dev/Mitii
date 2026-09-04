import type { WindowBudgetPolicyOverrides } from "./contracts";

/**
 * Window-budget bands keyed by the same context-window cutoffs as loop policy
 * (`compact` &lt; 50k, `standard` &lt; 100k, else `wide`).
 *
 * Permanent ship values. Edit via `pnpm policy-admin` (HTML UI) or this file.
 * Developer Custom `mitii.tokenBudget.*` overrides are temporary local deltas.
 *
 * Merge order in `deriveWindowPolicy`:
 *   DEFAULT_WINDOW_BUDGET_POLICY  →  band overlays  →  optional host Custom overrides
 */

export const WINDOW_BUDGET_BANDS = ["compact", "standard", "wide"] as const;

export type WindowBudgetBand = (typeof WINDOW_BUDGET_BANDS)[number];

/**
 * Exclusive upper bound for each band except `wide`.
 * Must stay aligned with `LOOP_POLICY_WINDOW_BAND_CEILINGS`.
 */
export const WINDOW_BUDGET_BAND_CEILINGS = {
  compactMaxExclusive: 50_000,
  standardMaxExclusive: 100_000,
} as const;

export interface WindowBudgetBandDefinition {
  id: WindowBudgetBand;
  label: string;
  rangeLabel: string;
  /**
   * Partial overrides merged onto `DEFAULT_WINDOW_BUDGET_POLICY`.
   * Omit a key to keep the base default.
   */
  overrides: WindowBudgetPolicyOverrides;
}

/**
 * Shipped band table. Highest-probability capacity mix per window size.
 * Each band sets its primary knobs explicitly — do not leave a band empty
 * and rely on DEFAULT_WINDOW_BUDGET_POLICY for those knobs.
 */
export const WINDOW_BUDGET_BAND_TABLE: Record<
  WindowBudgetBand,
  WindowBudgetBandDefinition
> = {
  compact: {
    id: "compact",
    label: "Compact",
    rangeLabel: "< 50k",
    overrides: {
      // Log-tuned: more usable for tool-read loops; 6-file repair batches.
      maxUniqueFilesPerCallCap: 6,
      outputMinTokens: 5120,
      outputRatio: 0.3,
      outputWindowCapRatio: 0.3,
      repositoryShare: 0.26,
      conversationShare: 0.4,
      planShare: 0.06,
      skillsShare: 0.07,
      maxSkillsCap: 4,
    },
  },
  standard: {
    id: "standard",
    label: "Standard",
    rangeLabel: "50k – < 100k",
    overrides: {
      // Balanced mid windows: lower output tax than compact, more repo.
      maxUniqueFilesPerCallCap: 8,
      outputMinTokens: 8192,
      outputRatio: 0.22,
      outputWindowCapRatio: 0.28,
      repositoryShare: 0.28,
      conversationShare: 0.38,
      planShare: 0.06,
      skillsShare: 0.05,
      maxSkillsCap: 4,
    },
  },
  wide: {
    id: "wide",
    label: "Wide",
    rangeLabel: "≥ 100k",
    overrides: {
      // Large windows: leaner output %, more repo/skills, larger batches.
      maxUniqueFilesPerCallCap: 12,
      outputMinTokens: 10_240,
      outputRatio: 0.18,
      outputWindowCapRatio: 0.25,
      repositoryShare: 0.3,
      conversationShare: 0.36,
      planShare: 0.06,
      skillsShare: 0.05,
      maxSkillsCap: 6,
      repositoryTokensCap: 180_000,
      planTokensCap: 48_000,
      skillsTokensCap: 24_000,
      toolResultContentCharsMax: 96_000,
    },
  },
};

/**
 * Resolve which window-budget band applies for an effective context window.
 * Non-finite / non-positive windows fall back to `compact`.
 */
export function resolveWindowBudgetBand(
  contextWindowTokens: number,
): WindowBudgetBand {
  const window = Math.floor(contextWindowTokens);
  if (!Number.isFinite(window) || window <= 0) {
    return "compact";
  }
  if (window < WINDOW_BUDGET_BAND_CEILINGS.compactMaxExclusive) {
    return "compact";
  }
  if (window < WINDOW_BUDGET_BAND_CEILINGS.standardMaxExclusive) {
    return "standard";
  }
  return "wide";
}

export function windowBudgetBandDefinition(
  band: WindowBudgetBand,
): WindowBudgetBandDefinition {
  return WINDOW_BUDGET_BAND_TABLE[band];
}

export function listWindowBudgetBands(): readonly WindowBudgetBandDefinition[] {
  return WINDOW_BUDGET_BANDS.map((id) => WINDOW_BUDGET_BAND_TABLE[id]);
}
