/**
 * Codex-derived fragment size formulae, adapted as Mitii prompt-construction policy.
 *
 * Codex AGENTS.md (Model visible context):
 * 3. No unbounded items — every injection must have a bounded size and hard cap.
 * 4. No items larger than 10K tokens.
 * 5. Highlight new individual items that can cross >1k tokens as P0 review.
 *
 * Codex additional_context.rs:
 * - MAX_ADDITIONAL_CONTEXT_VALUE_TOKENS = 1_000
 *
 * Important: reviewThreshold and soft defaults are NOT hard reject ceilings.
 * Only `absoluteMaxTokens` (and environment's additional-context budget) hard-cap
 * a fragment body. Soft defaults are hints for hosts/telemetry.
 */
export const FRAGMENT_POLICY = {
  /** Absolute hard cap per fragment (Codex rule 4). */
  absoluteMaxTokens: 10_000,

  /**
   * Fragments above this size are review-sensitive (Codex rule 5).
   * Assembly still allows them up to absoluteMaxTokens but flags them.
   */
  reviewThresholdTokens: 1_000,

  /**
   * Cap for single additional-context / environment value bodies
   * (Codex AdditionalContext truncate_middle budget).
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
