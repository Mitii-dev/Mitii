import { z } from "zod";

import { WINDOW_BUDGET_REASON_CODES } from "../../constants";
import { WINDOW_BUDGET_EFFORTS } from "../../effort";
import { windowBudgetPolicySchema } from "../input/WindowBudgetInput";

export const windowBudgetReasonCodeSchema = z.enum(WINDOW_BUDGET_REASON_CODES);

export type WindowBudgetReasonCode = z.infer<
  typeof windowBudgetReasonCodeSchema
>;

export const windowPolicySectionsSchema = z
  .object({
    repositoryTokens: z.number().int().nonnegative(),
    conversationTokens: z.number().int().nonnegative(),
    planTokens: z.number().int().positive(),
    skillsTokens: z.number().int().positive(),
    systemTokens: z.number().int().nonnegative(),
  })
  .strict();

export type WindowPolicySections = z.infer<typeof windowPolicySectionsSchema>;

export const windowPolicyCompactionSchema = z
  .object({
    warnRatio: z.number().min(0).max(1),
    autoRatio: z.number().min(0).max(1),
    hardRatio: z.number().min(0).max(1),
    keepRecentToolResults: z.number().int().positive(),
    compactedToolResultChars: z.number().int().positive(),
    compactedToolArgumentChars: z.number().int().positive(),
    toolResultContentChars: z.number().int().positive(),
    droppedTurnSummaryChars: z.number().int().positive(),
    establishedFactChars: z.number().int().positive(),
    maxEstablishedFacts: z.number().int().positive(),
    establishedFactReinjectChars: z.number().int().positive(),
    memoryReinjectChars: z.number().int().positive(),
    /** Absolute auto-compaction ceiling (effort overlay). */
    autoMaxTokens: z.number().int().positive(),
    /** Absolute hard-compaction ceiling (effort overlay). */
    hardMaxTokens: z.number().int().positive(),
  })
  .strict();

export type WindowPolicyCompaction = z.infer<
  typeof windowPolicyCompactionSchema
>;

export const windowPolicyMutationSchema = z
  .object({
    maxPatchesPerCall: z.number().int().positive(),
    maxUniqueFilesPerCall: z.number().int().positive(),
    maxPatchPayloadCharacters: z.number().int().positive(),
    preferredBatchSize: z.number().int().positive(),
    requireBatchedExecution: z.boolean(),
  })
  .strict();

export type WindowPolicyMutation = z.infer<typeof windowPolicyMutationSchema>;

export const windowPolicyPlanningSchema = z
  .object({
    maxDiagnosticSteps: z.number().int().positive(),
    visiblePlanAffordable: z.boolean(),
    changeImpactAffordable: z.boolean(),
    budgetTokens: z.number().int().positive(),
  })
  .strict();

export type WindowPolicyPlanning = z.infer<typeof windowPolicyPlanningSchema>;

export const windowPolicyRunSchema = z
  .object({
    maxModelCalls: z.number().int().positive(),
    maxToolCalls: z.number().int().positive(),
    maxVerificationRepairs: z.number().int().nonnegative(),
  })
  .strict();

export type WindowPolicyRun = z.infer<typeof windowPolicyRunSchema>;

export const windowPolicySkillsSchema = z
  .object({
    budgetTokens: z.number().int().positive(),
    maxSkills: z.number().int().positive(),
  })
  .strict();

export type WindowPolicySkills = z.infer<typeof windowPolicySkillsSchema>;

/**
 * Derived allocation for one advertised context window.
 * Consumers read named fields; they must not re-derive ratios.
 */
export const windowPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    contextWindowTokens: z.number().int().positive(),
    effort: z.enum(WINDOW_BUDGET_EFFORTS),
    maximumOutputTokens: z.number().int().positive(),
    toolSchemaTokens: z.number().int().nonnegative(),
    usableInputTokens: z.number().int().nonnegative(),
    loopInputBudgetTokens: z.number().int().positive(),
    sections: windowPolicySectionsSchema,
    compaction: windowPolicyCompactionSchema,
    mutation: windowPolicyMutationSchema,
    planning: windowPolicyPlanningSchema,
    run: windowPolicyRunSchema,
    skills: windowPolicySkillsSchema,
    maxVerificationChecks: z.number().int().positive(),
    resolvedPolicy: windowBudgetPolicySchema,
    reasonCodes: z.array(windowBudgetReasonCodeSchema),
  })
  .strict();

export type WindowPolicy = z.infer<typeof windowPolicySchema>;
