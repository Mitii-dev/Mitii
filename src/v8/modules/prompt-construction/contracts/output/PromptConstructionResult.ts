import { z } from "zod";

import { modelRequestSchema } from "../../../model-gateway";

import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
  PROMPT_CONSTRUCTION_STATUSES,
  PROMPT_OMISSION_REASONS,
  PROMPT_REASON_CODES,
  PROMPT_SECTIONS,
  PROMPT_TRUST_LEVELS,
} from "../../constants";

export const promptSectionSchema = z.enum(PROMPT_SECTIONS);
export const promptTrustLevelSchema = z.enum(PROMPT_TRUST_LEVELS);
export const promptOmissionReasonSchema = z.enum(PROMPT_OMISSION_REASONS);
export const promptConstructionStatusSchema = z.enum(
  PROMPT_CONSTRUCTION_STATUSES,
);
export const promptReasonCodeSchema = z.enum(PROMPT_REASON_CODES);

export const promptSectionBudgetSchema = z
  .object({
    section: promptSectionSchema,
    allocatedTokens: z.number().int().nonnegative(),
    usedTokens: z.number().int().nonnegative(),
    omittedTokens: z.number().int().nonnegative(),
    truncatedTokens: z.number().int().nonnegative(),
  })
  .strict();

export type PromptSectionBudget = z.infer<typeof promptSectionBudgetSchema>;

export const promptBudgetReportSchema = z
  .object({
    contextWindowTokens: z.number().int().positive(),
    outputReservedTokens: z.number().int().nonnegative(),
    inputBudgetTokens: z.number().int().nonnegative(),
    sections: z.array(promptSectionBudgetSchema),
    totalUsedTokens: z.number().int().nonnegative(),
    totalOmittedTokens: z.number().int().nonnegative(),
    totalTruncatedTokens: z.number().int().nonnegative(),
    withinLimits: z.boolean(),
  })
  .strict();

export type PromptBudgetReport = z.infer<typeof promptBudgetReportSchema>;

export const promptProvenanceEntrySchema = z
  .object({
    blockId: z.string().min(1),
    section: promptSectionSchema,
    source: z.string().min(1),
    trust: promptTrustLevelSchema,
  })
  .strict();

export type PromptProvenanceEntry = z.infer<typeof promptProvenanceEntrySchema>;

export const promptOmissionSchema = z
  .object({
    section: promptSectionSchema,
    reason: promptOmissionReasonSchema,
    detail: z.string().min(1),
    tokens: z.number().int().nonnegative().optional(),
    source: z.string().min(1).optional(),
  })
  .strict();

export type PromptOmission = z.infer<typeof promptOmissionSchema>;

export const promptConstructionResultSchema = z
  .object({
    schemaVersion: z.literal(PROMPT_CONSTRUCTION_SCHEMA_VERSION),
    status: promptConstructionStatusSchema,
    request: modelRequestSchema,
    budget: promptBudgetReportSchema,
    provenance: z.array(promptProvenanceEntrySchema),
    omissions: z.array(promptOmissionSchema),
    warnings: z.array(z.string()),
    reasonCodes: z.array(promptReasonCodeSchema).min(1),
  })
  .strict();

export type PromptConstructionResult = z.infer<
  typeof promptConstructionResultSchema
>;

export type PromptSection = z.infer<typeof promptSectionSchema>;
export type PromptTrustLevel = z.infer<typeof promptTrustLevelSchema>;
export type PromptOmissionReason = z.infer<typeof promptOmissionReasonSchema>;
export type PromptConstructionStatus = z.infer<
  typeof promptConstructionStatusSchema
>;
export type PromptReasonCode = z.infer<typeof promptReasonCodeSchema>;
