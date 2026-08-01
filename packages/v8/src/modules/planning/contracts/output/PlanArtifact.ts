import { z } from "zod";

import {
  PLAN_CHANGE_IMPACTS,
  PLAN_CONTEXT_KINDS,
  PLAN_STEP_RISK_LEVELS,
  PLANNING_SCHEMA_VERSION,
} from "../../constants";

export const planStepRiskLevelSchema = z.enum(PLAN_STEP_RISK_LEVELS);
export const planChangeImpactSchema = z.enum(PLAN_CHANGE_IMPACTS);
export const planContextKindSchema = z.enum(PLAN_CONTEXT_KINDS);

export type PlanStepRiskLevel = z.infer<typeof planStepRiskLevelSchema>;
export type PlanChangeImpact = z.infer<typeof planChangeImpactSchema>;
export type PlanContextKind = z.infer<typeof planContextKindSchema>;

export const planContextRefSchema = z
  .object({
    kind: planContextKindSchema,
    ref: z.string().min(1).max(1_000),
    note: z.string().min(1).max(500).optional(),
  })
  .strict();

export type PlanContextRef = z.infer<typeof planContextRefSchema>;

export const planStepSchema = z
  .object({
    id: z.string().min(1).max(64),
    intent: z.string().min(1).max(500),
    targetRefs: z.array(z.string().min(1).max(500)).max(32).default([]),
    actionSummary: z.string().min(1).max(1_000),
    expectedOutcome: z.string().min(1).max(500),
    verification: z.string().min(1).max(500).optional(),
    riskLevel: planStepRiskLevelSchema.default("low"),
  })
  .strict();

export type PlanStep = z.infer<typeof planStepSchema>;

export const planPhaseSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    purpose: z.string().min(1).max(500),
    steps: z.array(planStepSchema).min(1).max(20),
    dependencies: z.array(z.string().min(1).max(64)).max(16).default([]),
    successCriteria: z.array(z.string().min(1).max(300)).max(12).default([]),
  })
  .strict();

export type PlanPhase = z.infer<typeof planPhaseSchema>;

export const planRiskSchema = z
  .object({
    id: z.string().min(1).max(64),
    summary: z.string().min(1).max(500),
    severity: planStepRiskLevelSchema,
    mitigation: z.string().min(1).max(500).optional(),
  })
  .strict();

export type PlanRisk = z.infer<typeof planRiskSchema>;

export const planAlternativeSchema = z
  .object({
    id: z.string().min(1).max(64),
    summary: z.string().min(1).max(500),
    tradeoff: z.string().min(1).max(500).optional(),
  })
  .strict();

export type PlanAlternative = z.infer<typeof planAlternativeSchema>;

export const planVerificationSchema = z
  .object({
    checks: z.array(z.string().min(1).max(300)).max(20).default([]),
    manualQa: z.array(z.string().min(1).max(300)).max(12).default([]),
    commands: z.array(z.string().min(1).max(300)).max(12).default([]),
  })
  .strict();

export type PlanVerification = z.infer<typeof planVerificationSchema>;

export const planDimensionsSchema = z
  .object({
    scope: z.string().min(1).max(64),
    risk: planStepRiskLevelSchema,
    clarity: z.string().min(1).max(64),
    complexity: z.string().min(1).max(64),
    changeImpact: z.array(planChangeImpactSchema).max(8).default([]),
  })
  .strict();

export type PlanDimensions = z.infer<typeof planDimensionsSchema>;

/**
 * Generic planning artifact — policy- and evidence-driven, not plan-type-driven.
 * Handles feature, bugfix, migration, refactor, etc. with one shape.
 */
export const planArtifactSchema = z
  .object({
    schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
    objective: z.string().min(1).max(1_000),
    assumptions: z.array(z.string().min(1).max(500)).max(20).default([]),
    openQuestions: z.array(z.string().min(1).max(500)).max(12).default([]),
    contextReviewed: z.array(planContextRefSchema).max(40).default([]),
    constraints: z.array(z.string().min(1).max(500)).max(20).default([]),
    dimensions: planDimensionsSchema,
    phases: z.array(planPhaseSchema).min(1).max(12),
    risks: z.array(planRiskSchema).max(20).default([]),
    alternatives: z.array(planAlternativeSchema).max(8).default([]),
    verification: planVerificationSchema,
    rollback: z.string().min(1).max(1_000).optional(),
    approvalRequired: z.boolean(),
    processHintsApplied: z.array(z.string().min(1).max(120)).max(16).default([]),
  })
  .strict();

export type PlanArtifact = z.infer<typeof planArtifactSchema>;
