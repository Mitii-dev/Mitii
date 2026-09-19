import { z } from "zod";

/**
 * Categories that may skip Tool Runtime approval prompts when opted in.
 * Does not add tools or effects — only skips the ask for already-granted work.
 */
export const APPROVAL_SKIP_CATEGORIES = [
  "write",
  "execute",
  "mcp",
  "network",
  "external",
] as const;

export const approvalSkipCategorySchema = z.enum(APPROVAL_SKIP_CATEGORIES);
export type ApprovalSkipCategory = z.infer<typeof approvalSkipCategorySchema>;

/**
 * Host UX auto-approve flags (Roo-style granularity).
 * Mapped onto grant.approvalSkipCategories by IntersectUserSafetyRules.
 */
export const userSafetyAutoApproveSchema = z
  .object({
    /** Skip approval for workspace_write / git_write (non-process) tools. */
    write: z.boolean().default(false),
    /** Skip approval for process_execute tools (e.g. run_command). */
    execute: z.boolean().default(false),
    /** Skip approval for mcp__* tools that would otherwise ask. */
    mcp: z.boolean().default(false),
    /** Reserved for network_access tools that require approval. */
    network: z.boolean().default(false),
    /** Skip approval for external_write tools (e.g. GitHub mutations). */
    external: z.boolean().default(false),
  })
  .strict();

export type UserSafetyAutoApprove = z.infer<typeof userSafetyAutoApproveSchema>;
