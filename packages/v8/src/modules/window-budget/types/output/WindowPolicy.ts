import { z } from "zod";

import { WINDOW_BUDGET_REASON_CODES } from "../../constants";
import { WINDOW_BUDGET_EFFORTS } from "../../rules/effort";
import { WINDOW_BUDGET_MODES } from "../../rules/mode";
import { windowBudgetPolicySchema } from "../input/WindowBudgetInput";

export const windowBudgetReasonCodeSchema = z.enum(WINDOW_BUDGET_REASON_CODES);

export type WindowBudgetReasonCode = z.infer<
  typeof windowBudgetReasonCodeSchema
>;

export const windowBudgetStageTraceSchema = z
  .object({
    name: z.string().min(1),
    durationMs: z.number().nonnegative(),
    reasonCodes: z.array(windowBudgetReasonCodeSchema),
  })
  .strict();

export type WindowBudgetStageTrace = z.infer<
  typeof windowBudgetStageTraceSchema
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
    /**
     * Soft model-call checkpoint. Engine SHOULD offer Continue here when
     * work is unfinished — not fail the run.
     */
    maxModelCalls: z.number().int().positive(),
    /**
     * Hard safety ceiling. Engine MUST NOT exceed this even after Continue.
     * Always >= maxModelCalls.
     */
    hardMaxModelCalls: z.number().int().positive(),
    /** Soft tool-call checkpoint (paired with hardMaxToolCalls). */
    maxToolCalls: z.number().int().positive(),
    /** Hard tool-call safety ceiling. Always >= maxToolCalls. */
    hardMaxToolCalls: z.number().int().positive(),
    maxVerificationRepairs: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.hardMaxModelCalls < value.maxModelCalls) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "hardMaxModelCalls must be >= maxModelCalls",
        path: ["hardMaxModelCalls"],
      });
    }
    if (value.hardMaxToolCalls < value.maxToolCalls) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "hardMaxToolCalls must be >= maxToolCalls",
        path: ["hardMaxToolCalls"],
      });
    }
  });

export type WindowPolicyRun = z.infer<typeof windowPolicyRunSchema>;

export const windowPolicySkillsSchema = z
  .object({
    budgetTokens: z.number().int().positive(),
    maxSkills: z.number().int().positive(),
  })
  .strict();

export type WindowPolicySkills = z.infer<typeof windowPolicySkillsSchema>;

export const windowPolicyTaskListSchema = z
  .object({
    maxTasks: z.number().int().positive(),
  })
  .strict();

export type WindowPolicyTaskList = z.infer<typeof windowPolicyTaskListSchema>;

/** Host→engine prior-turn carry ceilings (message domain). */
export const windowPolicyCarrySchema = z
  .object({
    maxMessages: z.number().int().positive(),
    maxCharsPerMessage: z.number().int().positive(),
  })
  .strict();

export type WindowPolicyCarry = z.infer<typeof windowPolicyCarrySchema>;

/**
 * Pre-prompt host injection ceilings (settings / context blocks).
 * Character budgets scale with usable input; file/item maxima are absolute.
 */
export const windowPolicyInjectionSchema = z
  .object({
    projectRuleChars: z.number().int().positive(),
    projectRulesTotalChars: z.number().int().positive(),
    repoMapChars: z.number().int().positive(),
    repoMapFilesMax: z.number().int().positive(),
    sketchChars: z.number().int().positive(),
    sketchItemsMax: z.number().int().positive(),
    selectionChars: z.number().int().positive(),
    reviewDiffFileChars: z.number().int().positive(),
    reviewDiffTotalChars: z.number().int().positive(),
  })
  .strict();

export type WindowPolicyInjection = z.infer<typeof windowPolicyInjectionSchema>;

/** Prompt-construction per-fragment ceilings. */
export const windowPolicyFragmentsSchema = z
  .object({
    absoluteMaxTokens: z.number().int().positive(),
    reviewThresholdTokens: z.number().int().positive(),
    additionalContextValueTokens: z.number().int().positive(),
    skillCatalogL1MaxTokens: z.number().int().positive(),
    skillCatalogL1MaxEntries: z.number().int().positive(),
  })
  .strict();

export type WindowPolicyFragments = z.infer<typeof windowPolicyFragmentsSchema>;

/**
 * Derived allocation for one advertised context window.
 * Consumers read named fields; they must not re-derive ratios.
 */
export const windowPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    contextWindowTokens: z.number().int().positive(),
    effort: z.enum(WINDOW_BUDGET_EFFORTS),
    /** Present when a mode overlay was applied. */
    mode: z.enum(WINDOW_BUDGET_MODES).optional(),
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
    taskList: windowPolicyTaskListSchema,
    carry: windowPolicyCarrySchema,
    injection: windowPolicyInjectionSchema,
    fragments: windowPolicyFragmentsSchema,
    maxVerificationChecks: z.number().int().positive(),
    resolvedPolicy: windowBudgetPolicySchema,
    reasonCodes: z.array(windowBudgetReasonCodeSchema),
    /** Optional per-flow-stage timing (filled by WindowBudgetPipeline). */
    stages: z.array(windowBudgetStageTraceSchema).optional(),
  })
  .strict();

export type WindowPolicy = z.infer<typeof windowPolicySchema>;
