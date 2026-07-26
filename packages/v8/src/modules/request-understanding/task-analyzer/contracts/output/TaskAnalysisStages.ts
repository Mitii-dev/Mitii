import { z } from "zod";

import { INTENT_CONSTANTS } from "../../../intent/constants";
import {
  InteractionIntentEnum,
} from "../../../intent/schema";
import {
  TaskAnalysisSignalSchema,
  TaskClaritySchema,
  TaskComplexitySchema,
  TaskRiskSchema,
  TaskScopeSchema,
  TaskTargetSchema,
} from "./TaskAnalysis";

const taskIntentEnum = z.enum(INTENT_CONSTANTS.TASK_INTENTS);

export const ReferencedArtifactKindSchema = z.enum([
  "file",
  "folder",
  "attachment",
  "selection",
]);

export const ReferencedArtifactSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1).optional(),
  kind: ReferencedArtifactKindSchema,
  extension: z.string().optional(),
  language: z.string().optional(),
});

export const TaskConstraintKindSchema = z.enum([
  "prohibition",
  "restriction",
  "requirement",
  "preservation",
  "technology",
  "scope",
  "verification",
  "unknown",
]);

export const TaskComplexitySignalSchema = z.object({
  name: z.string(),
  score: z.number(),
  evidence: z.string(),
});

export const TaskComplexityDetailsSchema = z.object({
  complexity: TaskComplexitySchema,
  score: z.number(),
  signals: z.array(TaskComplexitySignalSchema),
});

export const TaskClaritySignalSchema = z.object({
  clarity: TaskClaritySchema,
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});

export const TaskClarityAnalysisSchema = z.object({
  clarity: TaskClaritySchema,
  confidence: z.number().min(0).max(1),
  signals: z.array(TaskClaritySignalSchema),
});

export const TaskClarityAnalyzerInputSchema = z.object({
  userMessage: z.string(),
  targets: z.array(TaskTargetSchema),
  intentConfidence: z.number().min(0).max(1),
  confidenceMargin: z.number().min(0).max(1),
  intentRequiresClarification: z.boolean(),
});

export const TaskScopeSignalSchema = z.object({
  scope: TaskScopeSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});

export const TaskScopeAnalysisSchema = z.object({
  scope: TaskScopeSchema,
  confidence: z.number().min(0).max(1),
  signals: z.array(TaskScopeSignalSchema),
});

export const TaskScopeAnalyzerInputSchema = z.object({
  userMessage: z.string(),
  targets: z.array(TaskTargetSchema),
});

export const TaskConstraintSchema = z.object({
  kind: TaskConstraintKindSchema,
  value: z.string().min(1),
  sourceText: z.string(),
  confidence: z.number().min(0).max(1),
});

export const TaskConstraintExtractionSchema = z.object({
  constraints: z.array(TaskConstraintSchema),
  values: z.array(z.string()),
  signals: z.array(TaskAnalysisSignalSchema),
  confidence: z.number().min(0).max(1),
});

export const TaskRiskSignalSchema = z.object({
  name: z.string(),
  score: z.number(),
  evidence: z.string(),
});

export const TaskRiskAnalysisSchema = z.object({
  risk: TaskRiskSchema,
  score: z.number(),
  confidence: z.number().min(0).max(1),
  signals: z.array(TaskRiskSignalSchema),
});

export const TaskRiskAnalyzerInputSchema = z.object({
  userMessage: z.string(),
  interactionIntent: InteractionIntentEnum,
  primaryTaskIntent: taskIntentEnum,
  scope: TaskScopeSchema,
  constraints: z.array(TaskConstraintSchema).optional(),
});

export const TaskOutcomeSchema = z.object({
  value: z.string().min(1),
  sourceText: z.string(),
  action: z.string(),
  confidence: z.number().min(0).max(1),
});

export const TaskOutcomeExtractionSchema = z.object({
  outcomes: z.array(TaskOutcomeSchema),
  values: z.array(z.string()),
  signals: z.array(TaskAnalysisSignalSchema),
  confidence: z.number().min(0).max(1),
});

export const OutcomeCandidateSchema = z.object({
  sourceText: z.string(),
  action: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ReferencedArtifactKind = z.infer<
  typeof ReferencedArtifactKindSchema
>;
export type ReferencedArtifact = z.infer<typeof ReferencedArtifactSchema>;
export type TaskConstraintKind = z.infer<typeof TaskConstraintKindSchema>;
export type TaskComplexitySignal = z.infer<typeof TaskComplexitySignalSchema>;
export type TaskComplexityDetails = z.infer<typeof TaskComplexityDetailsSchema>;
export type TaskClaritySignal = z.infer<typeof TaskClaritySignalSchema>;
export type TaskClarityAnalysis = z.infer<typeof TaskClarityAnalysisSchema>;
export type TaskClarityAnalyzerInput = z.infer<
  typeof TaskClarityAnalyzerInputSchema
>;
export type TaskScopeSignal = z.infer<typeof TaskScopeSignalSchema>;
export type TaskScopeAnalysis = z.infer<typeof TaskScopeAnalysisSchema>;
export type TaskScopeAnalyzerInput = z.infer<
  typeof TaskScopeAnalyzerInputSchema
>;
export type TaskConstraint = z.infer<typeof TaskConstraintSchema>;
export type TaskConstraintExtraction = z.infer<
  typeof TaskConstraintExtractionSchema
>;
export type TaskRiskSignal = z.infer<typeof TaskRiskSignalSchema>;
export type TaskRiskAnalysis = z.infer<typeof TaskRiskAnalysisSchema>;
export type TaskRiskAnalyzerInput = z.infer<typeof TaskRiskAnalyzerInputSchema>;
export type TaskOutcome = z.infer<typeof TaskOutcomeSchema>;
export type TaskOutcomeExtraction = z.infer<typeof TaskOutcomeExtractionSchema>;
export type OutcomeCandidate = z.infer<typeof OutcomeCandidateSchema>;
