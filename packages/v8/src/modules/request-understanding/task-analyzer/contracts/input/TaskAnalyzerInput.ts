import { z } from "zod";

import {
  InteractionIntentEnum,
  intentClassificationSchema,
} from "../../../intent/schema";
import { ReferencedArtifactSchema } from "../output/TaskAnalysisStages";

const superIntentScoreSchema = z.object({
  intent: intentClassificationSchema.shape.primaryTaskIntent,
  score: z.number(),
  ruleScore: z.number(),
  llmScore: z.number(),
});

const superIntentClarificationOptionSchema = z.object({
  intent: intentClassificationSchema.shape.primaryTaskIntent,
  label: z.string(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
});

const superIntentClarificationSchema = z.object({
  question: z.string(),
  options: z.array(superIntentClarificationOptionSchema),
});

const superIntentDiagnosticsSchema = z.object({
  ruleSource: z
    .enum(["explicit_rule", "heuristic_rule", "llm"])
    .optional(),
  matchedRule: z.string().optional(),
  rulePrimaryIntent: intentClassificationSchema.shape.primaryTaskIntent.optional(),
  llmPrimaryIntent: intentClassificationSchema.shape.primaryTaskIntent,
  ruleInteractionIntent: InteractionIntentEnum.optional(),
  llmInteractionIntent: InteractionIntentEnum,
  taskAgreement: z.boolean(),
  interactionAgreement: z.boolean(),
  interactionConflict: z.boolean(),
  agreementBonusApplied: z.number(),
  disagreementPenaltyApplied: z.number(),
  minimumConfidence: z.number(),
  minimumMargin: z.number(),
});

export const superIntentResultSchema = z.object({
  status: z.enum(["accepted", "clarification_required"]),
  classification: intentClassificationSchema,
  scores: z.array(superIntentScoreSchema),
  confidenceMargin: z.number().min(0).max(1),
  recommendsClarification: z.boolean(),
  clarification: superIntentClarificationSchema.optional(),
  diagnostics: superIntentDiagnosticsSchema,
});

export const taskAnalyzerInputSchema = z.object({
  userMessage: z.string(),
  intent: superIntentResultSchema,
  referencedArtifacts: z.array(ReferencedArtifactSchema).optional(),
  /**
   * Optional workspace-relative paths (e.g. repo-map entries) used to fuzzy-
   * resolve basename / partial file targets after explicit extraction.
   */
  candidateRelativePaths: z.array(z.string().min(1)).optional(),
});

export type TaskAnalyzerInput = z.infer<typeof taskAnalyzerInputSchema>;
