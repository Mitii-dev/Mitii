import { z } from "zod";

import { windowBudgetPolicyOverridesSchema } from "../../../modules/window-budget/contracts";
import { agentEngineThresholdsOverridesSchema } from "../actions/resolveAgentEngineThresholds";

/**
 * Policy Lab schema version. Bump only when the file shape breaks.
 */
export const POLICY_LAB_SCHEMA_VERSION = 1 as const;

const bandLoopMapSchema = z
  .object({
    compact: agentEngineThresholdsOverridesSchema.optional(),
    standard: agentEngineThresholdsOverridesSchema.optional(),
    wide: agentEngineThresholdsOverridesSchema.optional(),
  })
  .strict()
  .default({});

const bandWindowMapSchema = z
  .object({
    compact: windowBudgetPolicyOverridesSchema.optional(),
    standard: windowBudgetPolicyOverridesSchema.optional(),
    wide: windowBudgetPolicyOverridesSchema.optional(),
  })
  .strict()
  .default({});

/**
 * Workspace lab file (`.mitii/policy-lab.json`).
 *
 * When `enabled`, band-scoped overrides merge after shipped band tables and
 * before optional VS Code Custom / CLI one-off overrides.
 */
export const policyLabFileSchema = z
  .object({
    schemaVersion: z.literal(POLICY_LAB_SCHEMA_VERSION),
    enabled: z.boolean().default(false),
    /**
     * Optional window used for Admin preview when the provider window is unset.
     */
    previewContextWindowTokens: z.number().int().positive().optional(),
    loop: bandLoopMapSchema,
    window: bandWindowMapSchema,
  })
  .strict();

export type PolicyLabFile = z.infer<typeof policyLabFileSchema>;

export const EMPTY_POLICY_LAB: PolicyLabFile = {
  schemaVersion: POLICY_LAB_SCHEMA_VERSION,
  enabled: false,
  loop: {},
  window: {},
};

/**
 * Parse unknown JSON into a PolicyLabFile. Invalid input throws ZodError.
 */
export function parsePolicyLabFile(raw: unknown): PolicyLabFile {
  return policyLabFileSchema.parse(raw);
}

/**
 * Soft-parse: invalid or missing → empty disabled lab.
 */
export function tryParsePolicyLabFile(raw: unknown): PolicyLabFile {
  const parsed = policyLabFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...EMPTY_POLICY_LAB };
}
