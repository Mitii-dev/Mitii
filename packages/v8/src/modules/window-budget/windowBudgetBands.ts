import type { WindowBudgetPolicyOverrides } from "./contracts";

/**
 * Window-budget bands keyed by the same context-window cutoffs as loop policy
 * (`compact` &lt; 50k, `standard` &lt; 100k, else `wide`).
 *
 * Permanent ship values. Edit via Developer → Policy Admin → Save to ship code,
 * or edit this file directly. Developer Custom `mitii.tokenBudget.*` overrides
 * are temporary local deltas — not the ship source of truth.
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
 * Shipped band table. Compact leans mutation; wide opens skills capacity.
 * Standard keeps `DEFAULT_WINDOW_BUDGET_POLICY` as-is.
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
      // Scarce usable input: leaner mutation batches, slightly more skills,
      // slightly less repo so conversation + skills can finish the turn.
      maxUniqueFilesPerCallCap: 6,
      skillsShare: 0.05,
      repositoryShare: 0.25,
      maxSkillsCap: 4,
    },
  },
  standard: {
    id: "standard",
    label: "Standard",
    rangeLabel: "50k – < 100k",
    // Empty on purpose: base DEFAULT_WINDOW_BUDGET_POLICY is the standard band.
    overrides: {},
  },
  wide: {
    id: "wide",
    label: "Wide",
    rangeLabel: "≥ 100k",
    overrides: {
      // Room to spare: more skills; mutation stays effort-capped (medium: 8).
      maxSkillsCap: 6,
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
