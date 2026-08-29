import { z } from "zod";

import { AGENT_ENGINE_THRESHOLDS } from "../policy";

const positiveIntSchema = z.number().int().positive();
const nonnegativeIntSchema = z.number().int().nonnegative();
const ratioSchema = z.number().min(0).max(1);

/**
 * Full Agent Engine loop/stall thresholds. Working standards live in
 * `AGENT_ENGINE_THRESHOLDS`; hosts may pass a partial override for lab tweaks.
 */
export const agentEngineThresholdsSchema = z
  .object({
    // Recovery / nudge budgets: 0 disables that recovery path (lab tweaks).
    maxTruncationRecoveries: nonnegativeIntSchema,
    maxIncompleteAnswerRecoveries: nonnegativeIntSchema,
    maxUnfulfilledExecuteRecoveries: nonnegativeIntSchema,
    maxRejectedMutationRecoveries: nonnegativeIntSchema,
    maxMustReadNudges: nonnegativeIntSchema,
    maxReadOnlyMutationRetryAttempts: nonnegativeIntSchema,
    maxReadOnlyToolTurnsBeforeMutationNudge: positiveIntSchema,
    maxReadOnlyToolTurnsAfterMutationNudge: positiveIntSchema,
    maxReadOnlyToolTurnsAfterMutationNudges: nonnegativeIntSchema,
    verificationRepairModelCallReserveRatio: ratioSchema,
    defaultPreferredBatchSize: positiveIntSchema,
    defaultMaxPatchesPerCall: positiveIntSchema,
    explorationRereadRatio: z.number().positive(),
    explorationRereadMinCalls: positiveIntSchema,
    maxExplorationStallNudges: nonnegativeIntSchema,
    maxVerificationRepairAttempts: nonnegativeIntSchema,
    maxStalledVerificationRepairs: positiveIntSchema,
    maxRecoveredAnalysisChars: positiveIntSchema,
  })
  .strict();

export type AgentEngineThresholds = z.infer<typeof agentEngineThresholdsSchema>;

export const agentEngineThresholdsOverridesSchema =
  agentEngineThresholdsSchema.partial();

export type AgentEngineThresholdsOverrides = z.infer<
  typeof agentEngineThresholdsOverridesSchema
>;

/**
 * Merge optional host overrides onto working standards.
 * Undefined keys keep the shipped default.
 */
export function resolveAgentEngineThresholds(
  overrides?: AgentEngineThresholdsOverrides,
): AgentEngineThresholds {
  const base: AgentEngineThresholds = { ...AGENT_ENGINE_THRESHOLDS };
  if (!overrides) {
    return base;
  }
  const parsed = agentEngineThresholdsOverridesSchema.parse(overrides);
  return {
    ...base,
    ...stripUndefined(parsed),
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const next: Partial<T> = {};
  for (const [key, entry] of Object.entries(value) as Array<
    [keyof T, T[keyof T] | undefined]
  >) {
    if (entry !== undefined) {
      next[key] = entry;
    }
  }
  return next;
}
