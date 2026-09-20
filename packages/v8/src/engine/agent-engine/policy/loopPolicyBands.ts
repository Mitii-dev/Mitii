import type { AgentEngineThresholdsOverrides } from "../actions/resolveAgentEngineThresholds";

/**
 * Window bands for shipped loop/stall standards.
 *
 * Permanent ship values. Edit via `pnpm policy-admin` (HTML UI) or this file.
 * Developer Custom `mitii.loopPolicy.*` overrides are temporary local deltas.
 *
 * Merge order at run start:
 *   AGENT_ENGINE_THRESHOLDS  →  band overrides  →  optional Custom host overrides
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
 * Shipped band table. Highest-probability defaults for each window size.
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
      // 30k–49k local windows: generous explore + evidence for multi-file
      // feature work, still mutation-first after that. Keep recovered essays
      // short and allow a few extra stale-hunk retries. Cap verification
      // repair so simple TS API mismatches cannot burn 20+ minutes.
      explorationRereadMinCalls: 5,
      maxReadOnlyMutationRetryAttempts: 2,
      maxReadOnlyToolTurnsBeforeMutationNudge: 15,
      maxPostNudgeEvidenceReadTurns: 6,
      maxReadOnlyToolTurnsAfterMutationNudge: 4,
      maxReadOnlyToolTurnsAfterMutationNudges: 2,
      maxUnfulfilledExecuteRecoveries: 4,
      maxRecoveredAnalysisChars: 560,
      maxRejectedMutationRecoveries: 4,
      maxTruncationRecoveries: 4,
      maxVerificationRepairAttempts: 4,
      maxStalledVerificationRepairs: 1,
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
      // Large windows: more explore + evidence room than compact.
      maxReadOnlyToolTurnsBeforeMutationNudge: 18,
      maxPostNudgeEvidenceReadTurns: 8,
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
