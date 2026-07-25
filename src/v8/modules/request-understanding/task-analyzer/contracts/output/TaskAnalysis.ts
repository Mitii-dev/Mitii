import { z } from "zod";

export const TaskScopeSchema = z.enum([
  "single_location",
  "multi_file",
  "package",
  "repository",
  "workspace",
  "unknown",
]);

export const TaskComplexitySchema = z.enum([
  "trivial",
  "simple",
  "moderate",
  "complex",
  "very_complex",
]);

export const TaskRiskSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const TaskClaritySchema = z.enum([
  "clear",
  "partially_clear",
  "unclear",
]);

export const TaskTargetKindSchema = z.enum([
  "file",
  "folder",
  "symbol",
  "package",
  "repository",
  "workspace",
  "unknown",
]);

export const TaskAnalysisSignalTypeSchema = z.enum([
  "scope",
  "complexity",
  "risk",
  "clarity",
  "constraint",
  "verification",
]);

export const TaskTargetSchema = z.object({
  kind: TaskTargetKindSchema,
  value: z.string().min(1),
  explicit: z.boolean(),
});

export const TaskAnalysisSignalSchema = z.object({
  type: TaskAnalysisSignalTypeSchema,
  value: z.string(),
  weight: z.number().min(0).max(1),
  evidence: z.string(),
});

export const EstimatedFileImpactSchema = z.object({
  minimum: z.number().int().nonnegative(),
  maximum: z.number().int().nonnegative().optional(),
});

export const TaskAnalysisSchema = z.object({
  scope: TaskScopeSchema,
  complexity: TaskComplexitySchema,
  risk: TaskRiskSchema,
  clarity: TaskClaritySchema,
  targets: z.array(TaskTargetSchema),
  constraints: z.array(z.string()),
  requestedOutcomes: z.array(z.string()),
  recommendsRepositoryDiscovery: z.boolean(),
  recommendsPlanning: z.boolean(),
  recommendsVerification: z.boolean(),
  recommendsTaskClarification: z.boolean(),
  estimatedFilesAffected: EstimatedFileImpactSchema.optional(),
  signals: z.array(TaskAnalysisSignalSchema),
  confidence: z.number().min(0).max(1),
});

export type TaskScope = z.infer<typeof TaskScopeSchema>;
export type TaskComplexity = z.infer<typeof TaskComplexitySchema>;
export type TaskRisk = z.infer<typeof TaskRiskSchema>;
export type TaskClarity = z.infer<typeof TaskClaritySchema>;
export type TaskTarget = z.infer<typeof TaskTargetSchema>;
export type TaskAnalysisSignalType = z.infer<
  typeof TaskAnalysisSignalTypeSchema
>;
export type TaskAnalysisSignal = z.infer<typeof TaskAnalysisSignalSchema>;
export type EstimatedFileImpact = z.infer<typeof EstimatedFileImpactSchema>;
export type TaskAnalysis = z.infer<typeof TaskAnalysisSchema>;
