/**
 * Contracts for prepareStartInput — shared MitiiStartInput assembly.
 */

import { z } from 'zod';
import type { AgentMode, MitiiStartInput } from '@mitii/sdk';
import type { UserSafetyRules } from '@mitii/v8';

export const HOST_START_REASON_CODES = [
  'invalid_prepare_start_input',
  'unknown_mode_profile',
] as const;
export type HostStartReasonCode = (typeof HOST_START_REASON_CODES)[number];

/** Thrown when prepareStartInput options fail boundary validation. */
export class HostStartOptionsError extends Error {
  constructor(
    readonly code: HostStartReasonCode,
    message: string,
  ) {
    super(message);
    this.name = 'HostStartOptionsError';
  }
}

export const hostUiModeSchema = z.enum(['ask', 'plan', 'agent', 'database']);
export type HostUiMode = z.infer<typeof hostUiModeSchema>;

export const hostThoroughnessSchema = z.enum(['low', 'medium', 'high']);
export type HostThoroughness = z.infer<typeof hostThoroughnessSchema>;

export const hostUserSafetyModeSchema = z.enum(['off', 'disk']);
export type HostUserSafetyMode = z.infer<typeof hostUserSafetyModeSchema>;

export const prepareStartInputOptionsSchema = z
  .object({
    prompt: z.string().min(1),
    workspaceRoot: z.string().min(1).optional(),
    uiMode: hostUiModeSchema.optional(),

    approvalPreset: z.string().optional(),
    approvalOverride: z
      .object({
        approvalMode: z
          .enum(['never', 'when_required', 'every_mutation'])
          .optional(),
        planApproval: z.enum(['policy', 'never']).optional(),
      })
      .strict()
      .optional(),

    thoroughness: hostThoroughnessSchema.optional(),
    explorationDepth: z.enum(['quick', 'auto', 'deep']).optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),

    projectRulesBudget: z
      .object({
        maxRuleChars: z.number().int().positive().optional(),
        maxTotalChars: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),

    /** Default true when workspaceRoot is set. */
    loadDiskProjectRules: z.boolean().optional(),
    /** Default true when workspaceRoot is set. */
    loadModeProfiles: z.boolean().optional(),
    /**
     * Disk `.mitii/safety.json` load. Default `disk` (no-op when file missing
     * or disabled). VS Code may pass `off` when the setting is disabled.
     */
    userSafety: hostUserSafetyModeSchema.optional(),
    profileOverride: z.string().min(1).optional(),

    dbAccess: z.enum(['readonly', 'readwrite']).optional(),

    model: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    pinnedPaths: z.array(z.string().min(1)).max(32).optional(),
    requiredSkillIds: z.array(z.string().min(1).max(64)).max(16).optional(),
    requiredMcpServerIds: z
      .array(z.string().min(1).max(64))
      .max(16)
      .optional(),
    excludedSkillIds: z.array(z.string().min(1).max(64)).max(20).optional(),
    windowBudgetPolicy: z.record(z.string(), z.number()).optional(),
    maximumOutputTokens: z.number().int().nonnegative().optional(),
    logVerbosity: z.enum(['minimal', 'standard', 'verbose']).optional(),
    origin: z.enum(['user', 'automation', 'api']).optional(),
    maxWallTimeMs: z.number().int().positive().optional(),
  })
  .strict();

/** Scalar/Zod-validated options plus typed SDK fragments hosts may attach. */
export type PrepareStartInputOptions = z.infer<
  typeof prepareStartInputOptionsSchema
> & {
  /** Extra safety fragments (e.g. CLI hooks) merged after disk rules. */
  extraUserSafetyRules?: UserSafetyRules;
  conversation?: MitiiStartInput['conversation'];
  approvedPlan?: MitiiStartInput['approvedPlan'];
  approvedPlanStrategy?: MitiiStartInput['approvedPlanStrategy'];
  taskList?: MitiiStartInput['taskList'];
  environment?: MitiiStartInput['environment'];
  budget?: MitiiStartInput['budget'];
  loopPolicy?: MitiiStartInput['loopPolicy'];
  v8LoopPolicy?: MitiiStartInput['v8LoopPolicy'];
  attachments?: MitiiStartInput['attachments'];
  steering?: MitiiStartInput['steering'];
  autonomyPreset?: MitiiStartInput['autonomyPreset'];
};

export interface PrepareStartInputMeta {
  approvalPreset: string;
  usedDatabaseOverlay: boolean;
  /** Active mode profile slug when applied. */
  usedModeProfile?: string;
  /** Human-readable mode profile name when applied. */
  usedModeProfileName?: string;
  projectRulesCount: number;
}

export interface PrepareStartInputResult {
  start: MitiiStartInput;
  effectiveMode: AgentMode;
  meta: PrepareStartInputMeta;
}
