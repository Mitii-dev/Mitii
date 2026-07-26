import { z } from "zod";

import {
  APPROVAL_MODES,
  TOOL_EFFECTS,
  WORKSPACE_EFFECTS,
} from "../../constants";

export const workspaceEffectSchema = z.enum(WORKSPACE_EFFECTS);
export const toolEffectSchema = z.enum(TOOL_EFFECTS);
export const approvalModeSchema = z.enum(APPROVAL_MODES);

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
  })
  .strict();

export type ToolGrant = z.infer<typeof toolGrantSchema>;
