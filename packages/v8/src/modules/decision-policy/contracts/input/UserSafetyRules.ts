import { z } from "zod";

import { approvalModeSchema } from "../output/ToolGrant";
import {
  APPROVAL_SKIP_CATEGORIES,
  approvalSkipCategorySchema,
  userSafetyAutoApproveSchema,
} from "../shared/ApprovalSkip";

export {
  APPROVAL_SKIP_CATEGORIES,
  approvalSkipCategorySchema,
  userSafetyAutoApproveSchema,
};
export type {
  ApprovalSkipCategory,
  UserSafetyAutoApprove,
} from "../shared/ApprovalSkip";

/**
 * Host-supplied tighten-only safety rules.
 *
 * Semantics (MUST):
 * - When `enabled` is false, Decision Policy ignores this object.
 * - Rules MAY only remove tools/effects/prefixes/hosts, force stricter
 *   approval, or deny path scopes — they MUST NEVER widen a policy grant.
 * - Mode seals (Ask/Plan) remain absolute and are applied before this intersect.
 * - `autoApprove` / `approvalSkipCategories` only affect ask UX for tools
 *   already present on the grant; they MUST NOT add tools or effects.
 * - `protectedPathGlobs` force approval even when auto-approve would skip.
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
    /**
     * Granular auto-approve (host UX). Copied onto the grant as
     * approvalSkipCategories — never widens allowedTools/effects.
     */
    autoApprove: userSafetyAutoApproveSchema.optional(),
    /**
     * Workspace-relative globs that always require approval on write,
     * even when autoApprove.write is true (e.g. `.mitii/**`, `AGENTS.md`).
     */
    protectedPathGlobs: z.array(z.string().min(1)).default([]),
    /**
     * When set, mutation tools may only touch relative paths matching this
     * regex (e.g. Architect mode: `\\.md$`). Tighten-only.
     */
    mutationRelativePathRegex: z.string().min(1).optional(),
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
  protectedPathGlobs: [],
};

/** Default protected config paths — hosts MAY merge these into safety.json. */
export const DEFAULT_PROTECTED_PATH_GLOBS: readonly string[] = [
  ".mitii/**",
  ".mitiiignore",
  "AGENTS.md",
  "AGENT.md",
  "AGENTS.local.md",
  "MITTII.local.md",
];
