import type { AgentEngineThresholdsOverrides } from "../actions/resolveAgentEngineThresholds";

/**
 * Window bands for shipped loop/stall standards.
 *
 * **Edit this file** to change permanent per-window behavior after lab testing.
 * Developer `mitii.loopPolicy.*` overrides are temporary deltas on top of the
 * active band — they are not the ship source of truth.
 *
 * Merge order at run start:
 *   AGENT_ENGINE_THRESHOLDS  →  band overrides  →  lab overrides (optional)
 *
 * Cutoffs are exclusive upper bounds except `wide` (open-ended).
 */
export const LOOP_POLICY_WINDOW_BANDS = ["compact", "standard", "wide"] as const;

export type LoopPolicyWindowBand = (typeof LOOP_POLICY_WINDOW_BANDS)[number];

/**
 * Exclusive upper bound for each band except `wide`.
 * compact:  [0, COMPACT_MAX)
 * standard: [COMPACT_MAX, STANDARD_MAX)
 * wide:     [STANDARD_MAX, ∞)
 */
export const LOOP_POLICY_WINDOW_BAND_CEILINGS = {
  /** Anything below this uses compact (small local windows, e.g. 30k–49k). */
  compactMaxExclusive: 50_000,
  /** Anything below this (and ≥ compact max) uses standard. */
  standardMaxExclusive: 100_000,
} as const;

export interface LoopPolicyWindowBandDefinition {
  id: LoopPolicyWindowBand;
  /** Short UI / docs label. */
  label: string;
  /** Human range, e.g. "< 50k". */
  rangeLabel: string;
  /**
   * Partial overrides merged onto `AGENT_ENGINE_THRESHOLDS`.
   * Omit a key to keep the base working standard.
   */
  overrides: AgentEngineThresholdsOverrides;
}

/**
 * Shipped band table. Tune after day-to-day testing with Custom loop policy,
 * then promote proven values here and leave Custom off for deploy.
 */
export const LOOP_POLICY_WINDOW_BAND_TABLE: Record<
  LoopPolicyWindowBand,
  LoopPolicyWindowBandDefinition
> = {
  compact: {
    id: "compact",
    label: "Compact",
    rangeLabel: "< 50k",
    overrides: {
      // Small windows fill fast: allow more reads before forcing a patch,
      // more stale-hunk recoveries, and keep recovered essays shorter.
      explorationRereadMinCalls: 12,
      maxReadOnlyToolTurnsBeforeMutationNudge: 10,
      maxReadOnlyMutationRetryAttempts: 3,
      maxRejectedMutationRecoveries: 4,
      maxTruncationRecoveries: 4,
      maxRecoveredAnalysisChars: 320,
    },
  },
  standard: {
    id: "standard",
    label: "Standard",
    rangeLabel: "50k – < 100k",
    // Empty on purpose: base `AGENT_ENGINE_THRESHOLDS` are the standard band.
    overrides: {},
  },
  wide: {
    id: "wide",
    label: "Wide",
    rangeLabel: "≥ 100k",
    overrides: {
      // Large windows invite exploration spin; keep pressure closer to base
      // and leave a bit more room for recovered analysis text.
      explorationRereadMinCalls: 8,
      maxReadOnlyToolTurnsBeforeMutationNudge: 6,
      maxReadOnlyMutationRetryAttempts: 2,
      maxRejectedMutationRecoveries: 3,
      maxTruncationRecoveries: 3,
      maxRecoveredAnalysisChars: 640,
    },
  },
};

/**
 * Resolve which band applies for an effective context window.
 * Non-finite / non-positive windows fall back to `compact` (safest small budget).
 */
export function resolveLoopPolicyWindowBand(
  contextWindowTokens: number,
): LoopPolicyWindowBand {
  const window = Math.floor(contextWindowTokens);
  if (!Number.isFinite(window) || window <= 0) {
    return "compact";
  }
  if (window < LOOP_POLICY_WINDOW_BAND_CEILINGS.compactMaxExclusive) {
    return "compact";
  }
  if (window < LOOP_POLICY_WINDOW_BAND_CEILINGS.standardMaxExclusive) {
    return "standard";
  }
  return "wide";
}

export function loopPolicyWindowBandDefinition(
  band: LoopPolicyWindowBand,
): LoopPolicyWindowBandDefinition {
  return LOOP_POLICY_WINDOW_BAND_TABLE[band];
}

export function listLoopPolicyWindowBands(): readonly LoopPolicyWindowBandDefinition[] {
  return LOOP_POLICY_WINDOW_BANDS.map(
    (id) => LOOP_POLICY_WINDOW_BAND_TABLE[id],
  );
}
