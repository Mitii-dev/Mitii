import { z } from "zod";

import { WINDOW_BUDGET_SCHEMA_VERSION } from "../../constants";

const ratioSchema = z.number().min(0).max(1);
const positiveIntSchema = z.number().int().positive();
const nonnegativeIntSchema = z.number().int().nonnegative();
const positiveNumberSchema = z.number().positive();

/**
 * All tunables that change how a context window is spent.
 * Hosts persist this object in developer settings.
 */
export const windowBudgetPolicySchema = z
  .object({
    outputRatio: ratioSchema,
    outputMinTokens: positiveIntSchema,
    outputMaxTokens: positiveIntSchema,
    outputWindowCapRatio: ratioSchema,
    toolSchemaFallbackTokens: nonnegativeIntSchema,
    toolSchemaFallbackWindowRatio: ratioSchema,
    minimumUsableInputTokens: positiveIntSchema,
    loopSafetyRatio: ratioSchema,
    repositoryShare: ratioSchema,
    conversationShare: ratioSchema,
    planShare: ratioSchema,
    skillsShare: ratioSchema,
    planTokensCap: positiveIntSchema,
    skillsTokensCap: positiveIntSchema,
    repositoryTokensCap: positiveIntSchema,
    compactionWarnRatio: ratioSchema,
    compactionAutoRatio: ratioSchema,
    compactionHardRatio: ratioSchema,
    keepRecentToolResultsRatio: ratioSchema,
    keepRecentToolResultsMin: positiveIntSchema,
    keepRecentToolResultsMax: positiveIntSchema,
    compactedToolResultCharsRatio: ratioSchema,
    compactedToolResultCharsMin: positiveIntSchema,
    compactedToolResultCharsMax: positiveIntSchema,
    compactedToolArgumentCharsRatio: ratioSchema,
    compactedToolArgumentCharsMin: positiveIntSchema,
    compactedToolArgumentCharsMax: positiveIntSchema,
    toolResultContentCharsRatio: ratioSchema,
    toolResultContentCharsMin: positiveIntSchema,
    toolResultContentCharsMax: positiveIntSchema,
    droppedTurnSummaryCharsRatio: ratioSchema,
    droppedTurnSummaryCharsMin: positiveIntSchema,
    droppedTurnSummaryCharsMax: positiveIntSchema,
    establishedFactCharsRatio: ratioSchema,
    establishedFactCharsMin: positiveIntSchema,
    establishedFactCharsMax: positiveIntSchema,
    establishedFactCountRatio: ratioSchema,
    establishedFactCountMin: positiveIntSchema,
    establishedFactCountMax: positiveIntSchema,
    establishedFactReinjectCharsRatio: ratioSchema,
    establishedFactReinjectCharsMin: positiveIntSchema,
    establishedFactReinjectCharsMax: positiveIntSchema,
    memoryReinjectCharsRatio: ratioSchema,
    memoryReinjectCharsMin: positiveIntSchema,
    memoryReinjectCharsMax: positiveIntSchema,
    filesPerOutputTokens: positiveNumberSchema,
    minUniqueFilesPerCall: positiveIntSchema,
    maxUniqueFilesPerCallCap: positiveIntSchema,
    patchPayloadOutputRatio: ratioSchema,
    charsPerOutputToken: positiveNumberSchema,
    requireBatchedBelowOutputTokens: nonnegativeIntSchema,
    visiblePlanMinUsableTokens: nonnegativeIntSchema,
    changeImpactMinUsableTokens: nonnegativeIntSchema,
    visiblePlanMinUsableRatio: ratioSchema,
    changeImpactMinUsableRatio: ratioSchema,
    maxPatchesPerCallCap: positiveIntSchema,
    diagnosticStepsBase: positiveIntSchema,
    diagnosticStepsPerUsable: positiveNumberSchema,
    diagnosticStepsMax: positiveIntSchema,
    maxModelCallsPerUsable: positiveNumberSchema,
    maxModelCallsMin: positiveIntSchema,
    maxModelCallsMax: positiveIntSchema,
    maxSkillsBase: positiveIntSchema,
    maxSkillsPerUsable: positiveNumberSchema,
    maxSkillsCap: positiveIntSchema,
    verificationChecksBase: positiveIntSchema,
    verificationChecksPerUsable: positiveNumberSchema,
    verificationChecksMax: positiveIntSchema,
  })
  .strict();

export type WindowBudgetPolicy = z.infer<typeof windowBudgetPolicySchema>;

export const windowBudgetPolicyOverridesSchema =
  windowBudgetPolicySchema.partial();

export type WindowBudgetPolicyOverrides = z.infer<
  typeof windowBudgetPolicyOverridesSchema
>;

/**
 * Boundary input: advertised window + optional host output cap + measured
 * tool-schema tokens + optional policy overrides.
 */
export const windowBudgetInputSchema = z
  .object({
    schemaVersion: z.literal(WINDOW_BUDGET_SCHEMA_VERSION),
    contextWindowTokens: positiveIntSchema,
    /**
     * Host/provider generation cap. Omit or set 0 to derive from the window.
     */
    maximumOutputTokens: nonnegativeIntSchema.optional(),
    /**
     * Measured tool-definition tokens. Omit or 0 to use the fallback policy.
     */
    toolSchemaTokens: nonnegativeIntSchema.optional(),
    policy: windowBudgetPolicyOverridesSchema.optional(),
  })
  .strict();

export type WindowBudgetInput = z.infer<typeof windowBudgetInputSchema>;
