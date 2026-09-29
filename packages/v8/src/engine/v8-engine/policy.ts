import { z } from "zod";

/**
 * Ship knobs for v8-engine.
 *
 * Primary behavioral knobs (≤10): soft mutation nudge, tool-loop soft/hard,
 * truncation recoveries, reasoning char budget, reasoning-abort recoveries,
 * unfulfilled execute, rejected mutation, continue overrides, verification
 * repairs.
 *
 * Related fields may share the table (tool-loop identical-call/result +
 * forced-reject; preferredBatchSize + maxPatchesPerCall; must-read soft;
 * ask/diagnose repeated-tool nudge + answer lock).
 *
 * Do not reintroduce Dropped legacy keys (see V8_ENGINE_DROPPED_LEGACY_KEYS).
 */
export const V8_ENGINE_THRESHOLDS = {
  /** Soft nudge after this many readonly tool turns with zero mutations. */
  maxReadOnlyTurnsBeforeMutationNudge: 12,
  /** Identical tool name+args batches before a soft “change approach” nudge. */
  toolLoopSoftIdentical: 3,
  /** Identical batches before forcing a final answer / rejecting further tools. */
  toolLoopHardIdentical: 6,
  /** Identical call and result pairs before forcing a final answer. */
  toolLoopIdenticalCallAndResult: 3,
  /** Rejected tool batches after force-final before the run is exhausted. */
  toolLoopForcedRejectLimit: 2,
  /**
   * Provider length / max_tokens recoveries. Counter resets when any tool
   * call appears on a turn.
   */
  maxTruncationRecoveries: 3,
  /**
   * Reasoning-channel characters with no content or tools before an honest
   * abort (separate from provider output-token truncation).
   */
  maxReasoningCharsWithoutProgress: 28_000,
  /**
   * Soft recoveries after a reasoning-progress abort. Separate from
   * maxTruncationRecoveries — exhausting this offers host Continue.
   */
  maxReasoningAbortRecoveries: 2,
  /** Text-only turns toward apply_patch when mutation is still required. */
  maxUnfulfilledExecuteRecoveries: 2,
  /**
   * Soft recoveries after a rejected mutating tool (stale hunk / identical
   * oldText). Separate from unfulfilled-execute text nudges.
   */
  maxRejectedMutationRecoveries: 3,
  /**
   * Soft withhold of the first mutating edit when active-task mustRead
   * paths are not yet in evidence. Does not spend a post-nudge evidence
   * lock — remaining is a soft budget only.
   */
  maxMustReadNudges: 1,
  /** User Continue overrides after stall / loop_detected walls. */
  maxContinueOverrides: 4,
  /** Remaining-error verification repairs after the first mutate loop. */
  maxVerificationRepairAttempts: 4,
  /** Preferred apply_patch batch sizing. */
  preferredBatchSize: 12,
  maxPatchesPerCall: 24,
  /**
   * Ask/diagnose: consecutive identical readonly tool turns before a soft
   * “answer now” nudge (related ask-discipline rail).
   */
  maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: 3,
  /** Ask/diagnose: soft answer nudges before stripping tools (answer lock). */
  maxDiagnoseAnswerNudges: 1,
} as const;

/**
 * Legacy agent-engine threshold keys that must never be ported into
 * V8_ENGINE_THRESHOLDS. Kept here so policy-admin / reviews can grep.
 */
export const V8_ENGINE_DROPPED_LEGACY_KEYS = [
  "maxPostNudgeEvidenceReadTurns",
  "maxReadOnlyMutationRetryAttempts",
  "maxMutationLockRecoveries",
  "maxMutationLockAutoStubBatches",
  "maxReasoningProgressBudgetExceedancesBeforeMutationLock",
  "forcePreflightRepairLock",
  "maxExplorationStallNudges",
  "explorationRereadHeavyRatio",
  "explorationRereadMinCalls",
] as const;

const nonnegativeIntSchema = z.number().int().nonnegative();
const positiveIntSchema = z.number().int().positive();

export const v8EngineThresholdsSchema = z
  .object({
    maxReadOnlyTurnsBeforeMutationNudge: positiveIntSchema,
    toolLoopSoftIdentical: positiveIntSchema,
    toolLoopHardIdentical: positiveIntSchema,
    toolLoopIdenticalCallAndResult: positiveIntSchema,
    toolLoopForcedRejectLimit: nonnegativeIntSchema,
    maxTruncationRecoveries: nonnegativeIntSchema,
    maxReasoningCharsWithoutProgress: positiveIntSchema,
    maxReasoningAbortRecoveries: nonnegativeIntSchema,
    maxUnfulfilledExecuteRecoveries: nonnegativeIntSchema,
    maxRejectedMutationRecoveries: nonnegativeIntSchema,
    maxMustReadNudges: nonnegativeIntSchema,
    maxContinueOverrides: nonnegativeIntSchema,
    maxVerificationRepairAttempts: nonnegativeIntSchema,
    preferredBatchSize: positiveIntSchema,
    maxPatchesPerCall: positiveIntSchema,
    maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: positiveIntSchema,
    maxDiagnoseAnswerNudges: nonnegativeIntSchema,
  })
  .strict();

export type V8EngineThresholds = z.infer<typeof v8EngineThresholdsSchema>;

export const v8EngineThresholdsOverridesSchema =
  v8EngineThresholdsSchema.partial();

export type V8EngineThresholdsOverrides = z.infer<
  typeof v8EngineThresholdsOverridesSchema
>;

export function resolveV8EngineThresholds(
  overrides?: V8EngineThresholdsOverrides,
): V8EngineThresholds {
  const base = { ...V8_ENGINE_THRESHOLDS };
  if (!overrides) {
    return base;
  }
  const parsed = v8EngineThresholdsOverridesSchema.parse(overrides);
  const next: V8EngineThresholds = { ...base };
  for (const [key, value] of Object.entries(parsed) as Array<
    [keyof V8EngineThresholds, number | undefined]
  >) {
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = value;
    }
  }
  return next;
}
