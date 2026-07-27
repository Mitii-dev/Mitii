import { z } from "zod";

import {
  executionRouteSchema,
  planningDepthSchema,
} from "../../../decision-policy";
import { agentModeSchema } from "../../../request-intake";

import { PLANNING_SCHEMA_VERSION } from "../../constants";
import { DEFAULT_PLANNING_BUDGET_TOKENS } from "../../defaults";
import {
  planArtifactSchema,
  planChangeImpactSchema,
  planContextRefSchema,
  planStepRiskLevelSchema,
} from "../output/PlanArtifact";

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
    evidence: planningTaskEvidenceSchema,
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
    /** User-edited or previously approved plan to revise/validate. */
    priorPlan: planArtifactSchema.optional(),
    budgetTokens: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_PLANNING_BUDGET_TOKENS),
  })
  .strict();

export type PlanningInput = z.input<typeof planningInputSchema>;
export type PlanningParsedInput = z.infer<typeof planningInputSchema>;
