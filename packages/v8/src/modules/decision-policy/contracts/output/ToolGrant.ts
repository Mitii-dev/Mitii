import { z } from "zod";

import {
  APPROVAL_MODES,
  TOOL_EFFECTS,
  WORKSPACE_EFFECTS,
} from "../../constants";

export const workspaceEffectSchema = z.enum(WORKSPACE_EFFECTS);
export const toolEffectSchema = z.enum(TOOL_EFFECTS);
export const approvalModeSchema = z.enum(APPROVAL_MODES);
export type ApprovalMode = z.infer<typeof approvalModeSchema>;

export const commandRuleSchema = z
  .object({
    prefixes: z.array(z.string().min(1)).min(1),
    allowShellMetacharacters: z.boolean().default(false),
    maxOutputBytes: z.number().int().positive().optional(),
  })
  .strict();

export type CommandRule = z.infer<typeof commandRuleSchema>;

export const toolGrantLimitsSchema = z
  .object({
    maxToolCalls: z.number().int().nonnegative(),
    maxWallTimeMs: z.number().int().nonnegative(),
    maxOutputBytes: z.number().int().nonnegative(),
    maxConcurrentTools: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ToolGrantLimits = z.infer<typeof toolGrantLimitsSchema>;

/**
 * Per-call mutation batch limits for write grants.
 * Protects provider output-token limits on large multi-file tasks.
 * Tool Runtime enforces hard caps; Agent Engine uses preferredBatchSize for prompting.
 */
export const mutationBudgetSchema = z
  .object({
    /** Absolute max structured patches in one apply_patch call. */
    maxPatchesPerCall: z.number().int().positive(),
    /** Absolute max unique file paths in one apply_patch call. */
    maxUniqueFilesPerCall: z.number().int().positive(),
    /** Soft cap on sum(oldText + newText) characters across patches. */
    maxPatchPayloadCharacters: z.number().int().positive(),
    /** Hint for the model: prefer batches around this many files. */
    preferredBatchSize: z.number().int().positive(),
    /** When true, Engine instructs the model to plan then batch strictly. */
    requireBatchedExecution: z.boolean(),
  })
  .strict();

export type MutationBudget = z.infer<typeof mutationBudgetSchema>;

export const toolGrantSchema = z
  .object({
    maximumWorkspaceEffect: workspaceEffectSchema,
    allowedTools: z.array(z.string().min(1)),
    allowedEffects: z.array(toolEffectSchema),
    pathScopes: z.array(z.string().min(1)).min(1),
    commandRules: z.array(commandRuleSchema).optional(),
    networkHosts: z.array(z.string().min(1)).optional(),
    approvalMode: approvalModeSchema,
    limits: toolGrantLimitsSchema,
    /** Present on write grants; omitted for read-only / none grants. */
    mutationBudget: mutationBudgetSchema.optional(),
  })
  .strict();

export type ToolGrant = z.infer<typeof toolGrantSchema>;
