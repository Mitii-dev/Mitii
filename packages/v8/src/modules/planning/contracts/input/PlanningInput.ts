import { z } from "zod";

import {
  executionRouteSchema,
  planningDepthSchema,
} from "../../../decision-policy";
import { agentModeSchema } from "../../../request-intake";
import { verificationDiagnosticSchema } from "../../../verification";

import { PLANNING_SCHEMA_VERSION } from "../../constants";
import { DEFAULT_PLANNING_BUDGET_TOKENS } from "../../defaults";
import { discoveryBriefSchema } from "./DiscoveryBrief";
import {
  planArtifactSchema,
  planChangeImpactSchema,
  planContextRefSchema,
  planStepRiskLevelSchema,
} from "../output/PlanArtifact";
import { planStrategyDecisionSchema } from "../output/PlanStrategyDecision";

/**
 * Slim task evidence for planning.
 * Engine maps Request Understanding into this slice so Planning never owns
 * classification internals.
 */
export const planningTaskEvidenceSchema = z
  .object({
    primaryIntent: z.string().min(1),
    secondaryIntents: z.array(z.string().min(1)).default([]),
    interactionIntent: z.string().min(1).optional(),
    scope: z.string().min(1),
    complexity: z.string().min(1),
    risk: planStepRiskLevelSchema,
    clarity: z.string().min(1),
    targets: z
      .array(
        z
          .object({
            kind: z.string().min(1),
            value: z.string().min(1),
            explicit: z.boolean(),
          })
          .strict(),
      )
      .default([]),
    constraints: z.array(z.string().min(1)).default([]),
    requestedOutcomes: z.array(z.string().min(1)).default([]),
    recommendsPlanning: z.boolean().optional(),
    recommendsVerification: z.boolean().optional(),
    changeImpact: z.array(planChangeImpactSchema).default([]),
  })
  .strict();

export type PlanningTaskEvidence = z.infer<typeof planningTaskEvidenceSchema>;

/**
 * Optional skill hint for PlanningInput.
 * Kept local (not imported from prompt-construction) to avoid module cycles.
 */
export const planningSkillHintSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    content: z.string().min(1),
    priority: z.number().int().nonnegative().default(100),
  })
  .strict();

export type PlanningSkillHint = z.infer<typeof planningSkillHintSchema>;

export const explorationDepthSchema = z.enum(["auto", "quick", "deep"]);

export const planningScopedRepoMapSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            path: z.string().min(1).max(1_000),
            kind: z.string().min(1).max(120).optional(),
            note: z.string().min(1).max(500).optional(),
          })
          .strict(),
      )
      .max(80),
  })
  .strict();

export const planningBuildEvidenceSchema = z
  .object({
    phase: z.literal("before"),
    summary: z.string().min(1).max(4_000),
    diagnostics: z.array(verificationDiagnosticSchema).max(200).optional(),
    failedChecks: z.array(z.string().min(1).max(300)).max(32).optional(),
  })
  .strict();

export type ExplorationDepth = z.infer<typeof explorationDepthSchema>;
export type PlanningScopedRepoMap = z.infer<typeof planningScopedRepoMapSchema>;
export type PlanningBuildEvidence = z.infer<typeof planningBuildEvidenceSchema>;

/**
 * Boundary input for Planning.
 *
 * `skills` and `processHints` are reserved slots for future process profiles
 * and skill-driven planning guidance. Planning remains dimension-driven;
 * these fields must not become hard-coded plan-type switches.
 */
export const planningInputSchema = z
  .object({
    schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
    query: z.string().min(1),
    mode: agentModeSchema,
    route: executionRouteSchema,
    planningDepth: planningDepthSchema,
    /** How hard Engine should look before drafting. Orthogonal to planningDepth (visible-plan-or-not). */
    explorationDepth: explorationDepthSchema.default("auto"),
    evidence: planningTaskEvidenceSchema,
    scopedRepoMap: planningScopedRepoMapSchema.optional(),
    buildEvidence: planningBuildEvidenceSchema.optional(),
    /**
     * Selected skill instruction blocks (from Skills module).
     * Optional — Planning must work when Skills is not wired.
     */
    skills: z.array(planningSkillHintSchema).max(8).optional(),
    /**
     * Lightweight process-profile hints (e.g. "auth_identity", "data_migration").
     * Reserved for configurable policies; empty by default.
     */
    processHints: z.array(z.string().min(1).max(120)).max(16).optional(),
    /** Already-reviewed context refs from repository context / discovery. */
    contextReviewed: z.array(planContextRefSchema).max(40).optional(),
    /** Structured evidence from a prior read-only discovery pass. */
    discoveryBrief: discoveryBriefSchema.optional(),
    /** User-edited or previously approved plan to revise/validate. */
    priorPlan: planArtifactSchema.optional(),
    /** Engine-owned strategy. Normal runs set this after resolvePlanStrategyRules. */
    strategyOverride: planStrategyDecisionSchema.optional(),
    budgetTokens: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_PLANNING_BUDGET_TOKENS),
    /** Window-derived cap for diagnostic change steps. */
    maxDiagnosticSteps: z.number().int().positive().optional(),
  })
  .strict();

export type PlanningInput = z.input<typeof planningInputSchema>;
export type PlanningParsedInput = z.infer<typeof planningInputSchema>;
