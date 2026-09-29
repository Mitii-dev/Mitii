import { z } from "zod";

/**
 * Ship knobs for v8-engine. Keep this table small — do not grow toward
 * agent-engine's large threshold surface. Related batch-size fields may
 * share the table; primary behavioral knobs stay ≤10.
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
  /** Text-only turns toward apply_patch when mutation is still required. */
  maxUnfulfilledExecuteRecoveries: 2,
  /** User Continue overrides after stall / loop_detected walls. */
  maxContinueOverrides: 4,
  /** Remaining-error verification repairs after the first mutate loop. */
  maxVerificationRepairAttempts: 4,
  /** Preferred apply_patch batch sizing. */
  preferredBatchSize: 12,
  maxPatchesPerCall: 24,
} as const;

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
    maxUnfulfilledExecuteRecoveries: nonnegativeIntSchema,
    maxContinueOverrides: nonnegativeIntSchema,
    maxVerificationRepairAttempts: nonnegativeIntSchema,
    preferredBatchSize: positiveIntSchema,
    maxPatchesPerCall: positiveIntSchema,
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
