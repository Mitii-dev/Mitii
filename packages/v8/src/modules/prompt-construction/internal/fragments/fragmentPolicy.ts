/**
 * Mitii fragment size formulae for prompt-construction policy.
 *
 * - No unbounded items — every injection must have a bounded size and hard cap.
 * - Absolute max per fragment: 10K tokens.
 * - Items that can cross >1k tokens are review-sensitive (flagged, not rejected).
 * - Additional-context / environment value bodies: 1_000 token hard budget.
 *
 * Important: reviewThreshold and soft defaults are NOT hard reject ceilings.
 * Only `absoluteMaxTokens` (and environment's additional-context budget) hard-cap
 * a fragment body. Soft defaults are hints for hosts/telemetry.
 *
 * Attribution / inspiration policy: see Mitii/NOTICE-REVIEW.md.
 */
export const FRAGMENT_POLICY = {
  /** Absolute hard cap per fragment. */
  absoluteMaxTokens: 10_000,

  /**
   * Fragments above this size are review-sensitive.
   * Assembly still allows them up to absoluteMaxTokens but flags them.
   */
  reviewThresholdTokens: 1_000,

  /**
   * Cap for single additional-context / environment value bodies
   * (truncate-middle budget).
   */
  additionalContextValueTokens: 1_000,

  /**
   * Preferred size for instruction blocks before review-flagging.
   * Not a hard truncate ceiling — see absoluteMaxTokens.
   */
  instructionBlockPreferredTokens: 2_000,

  /**
   * Preferred size for core system safety preamble before review-flagging.
   * Not a hard truncate ceiling — see absoluteMaxTokens.
   */
  baseInstructionsPreferredTokens: 2_500,

  /** Soft default for a single repository evidence block. */
  repositoryBlockPreferredTokens: 4_000,
} as const;
