import { z } from "zod";

import { approvalModeSchema } from "../output/ToolGrant";

/**
 * Host-supplied tighten-only safety rules.
 *
 * Semantics (MUST):
 * - When `enabled` is false, Decision Policy ignores this object.
 * - Rules MAY only remove tools/effects/prefixes/hosts, force stricter
 *   approval, or deny path scopes — they MUST NEVER widen a policy grant.
 * - Mode seals (Ask/Plan) remain absolute and are applied before this intersect.
 */
export const userSafetyRulesSchema = z
  .object({
    /** Master switch. Default false — opt-in only. */
    enabled: z.boolean().default(false),
    /** Tool ids to strip from the grant (intersect-remove). */
    denyTools: z.array(z.string().min(1)).default([]),
    /** Command prefixes that must never appear in commandRules. */
    denyCommandPrefixes: z.array(z.string().min(1)).default([]),
    /**
     * When the grant already allows these prefixes, keep them.
     * Does not add prefixes that policy did not grant.
     */
    allowCommandPrefixes: z.array(z.string().min(1)).optional(),
    /** Path scopes to remove from pathScopes / mutationPathScopes. */
    denyPathScopes: z.array(z.string().min(1)).default([]),
    /** Network hosts to strip. */
    denyNetworkHosts: z.array(z.string().min(1)).default([]),
    /**
     * Ceiling on approval mode. Only applied when stricter than the grant:
     * every_mutation > when_required > never.
     */
    approvalCeiling: approvalModeSchema.optional(),
  })
  .strict();

export type UserSafetyRules = z.infer<typeof userSafetyRulesSchema>;

/** Empty disabled rules — safe default for hosts. */
export const DISABLED_USER_SAFETY_RULES: UserSafetyRules = {
  enabled: false,
  denyTools: [],
  denyCommandPrefixes: [],
  denyPathScopes: [],
  denyNetworkHosts: [],
};
