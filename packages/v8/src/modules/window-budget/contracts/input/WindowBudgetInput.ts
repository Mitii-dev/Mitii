import { z } from "zod";

import { WINDOW_BUDGET_SCHEMA_VERSION } from "../../constants";
import { WINDOW_BUDGET_EFFORTS } from "../../rules/effort";
import { WINDOW_BUDGET_MODES } from "../../rules/mode";

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
    maxTasksBase: positiveIntSchema,
    maxTasksPerUsable: positiveNumberSchema,
    maxTasksCap: positiveIntSchema,
    maxModelCallsPerUsable: positiveNumberSchema,
    maxModelCallsMin: positiveIntSchema,
    maxModelCallsMax: positiveIntSchema,
    maxSkillsBase: positiveIntSchema,
    maxSkillsPerUsable: positiveNumberSchema,
    maxSkillsCap: positiveIntSchema,
    verificationChecksBase: positiveIntSchema,
    verificationChecksPerUsable: positiveNumberSchema,
    verificationChecksMax: positiveIntSchema,
    /**
     * Host→engine conversation carry (message count). Scaled from usable input.
     */
    carryMaxMessagesRatio: ratioSchema,
    carryMaxMessagesMin: positiveIntSchema,
    carryMaxMessagesMax: positiveIntSchema,
    /**
     * Per-message character ceiling when forwarding prior turns.
     * Scaled from usable input (same units as other `*CharsRatio` fields).
     */
    carryMaxCharsPerMessageRatio: ratioSchema,
    carryMaxCharsPerMessageMin: positiveIntSchema,
    carryMaxCharsPerMessageMax: positiveIntSchema,
    /** Single project-rule file body (AGENTS.md / .mitii/rules). */
    injectionProjectRuleCharsRatio: ratioSchema,
    injectionProjectRuleCharsMin: positiveIntSchema,
    injectionProjectRuleCharsMax: positiveIntSchema,
    /** Aggregate project-rules injection. */
    injectionProjectRulesTotalCharsRatio: ratioSchema,
    injectionProjectRulesTotalCharsMin: positiveIntSchema,
    injectionProjectRulesTotalCharsMax: positiveIntSchema,
    /** Host repo-map / workspace-sketch character budget. */
    injectionRepoMapCharsRatio: ratioSchema,
    injectionRepoMapCharsMin: positiveIntSchema,
    injectionRepoMapCharsMax: positiveIntSchema,
    /** Absolute file-count ceiling for repo-map assembly (not window-scaled). */
    injectionRepoMapFilesMax: positiveIntSchema,
    injectionSketchCharsRatio: ratioSchema,
    injectionSketchCharsMin: positiveIntSchema,
    injectionSketchCharsMax: positiveIntSchema,
    /** Absolute item-count ceiling for workspace sketch (not window-scaled). */
    injectionSketchItemsMax: positiveIntSchema,
    /** Editor selection injected into the prompt. */
    injectionSelectionCharsRatio: ratioSchema,
    injectionSelectionCharsMin: positiveIntSchema,
    injectionSelectionCharsMax: positiveIntSchema,
    /** Per-file review / git diff clip. */
    injectionReviewDiffFileCharsRatio: ratioSchema,
    injectionReviewDiffFileCharsMin: positiveIntSchema,
    injectionReviewDiffFileCharsMax: positiveIntSchema,
    /** Aggregate review / git diff clip. */
    injectionReviewDiffTotalCharsRatio: ratioSchema,
    injectionReviewDiffTotalCharsMin: positiveIntSchema,
    injectionReviewDiffTotalCharsMax: positiveIntSchema,
    /** Per-fragment hard token ceiling (prompt-construction). */
    fragmentAbsoluteMaxTokensRatio: ratioSchema,
    fragmentAbsoluteMaxTokensMin: positiveIntSchema,
    fragmentAbsoluteMaxTokensMax: positiveIntSchema,
    /** Soft review-flag threshold (not a hard reject). */
    fragmentReviewThresholdTokens: positiveIntSchema,
    /** Cap for additional-context / environment value bodies. */
    fragmentAdditionalContextValueTokensRatio: ratioSchema,
    fragmentAdditionalContextValueTokensMin: positiveIntSchema,
    fragmentAdditionalContextValueTokensMax: positiveIntSchema,
    /** L1 skill catalog strip (name+description). */
    fragmentSkillCatalogL1MaxTokensRatio: ratioSchema,
    fragmentSkillCatalogL1MaxTokensMin: positiveIntSchema,
    fragmentSkillCatalogL1MaxTokensMax: positiveIntSchema,
    /** Absolute entry count for L1 skill catalog (not window-scaled). */
    fragmentSkillCatalogL1MaxEntries: positiveIntSchema,
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
    /**
     * Working-set overlay. Omit for medium. Caps mutation batches, model
     * calls, and compaction ceilings independently of the advertised window.
     */
    effort: z.enum(WINDOW_BUDGET_EFFORTS).optional(),
    /**
     * Interaction-mode overlay (`ask` | `plan` | `agent`). Omit for no mode
     * delta (defaults + band + lab only).
     */
    mode: z.enum(WINDOW_BUDGET_MODES).optional(),
    /**
     * Model id used to look up a per-model window-budget profile. Omit when
     * unknown; no profile is applied.
     */
    modelId: z.string().min(1).optional(),
  })
  .strict();

export type WindowBudgetInput = z.infer<typeof windowBudgetInputSchema>;
