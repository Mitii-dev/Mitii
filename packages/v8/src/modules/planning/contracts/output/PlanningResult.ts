import { z } from "zod";

import {
  PLANNING_REASON_CODES,
  PLANNING_SCHEMA_VERSION,
  PLANNING_STATUSES,
} from "../../constants";
import { planArtifactSchema } from "./PlanArtifact";
import { planStrategyDecisionSchema } from "./PlanStrategyDecision";

export const planningStatusSchema = z.enum(PLANNING_STATUSES);
export const planningReasonCodeSchema = z.enum(PLANNING_REASON_CODES);

export const planningResultSchema = z
  .object({
    schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
    status: planningStatusSchema,
    plan: planArtifactSchema.optional(),
    warnings: z.array(z.string()),
    reasonCodes: z.array(planningReasonCodeSchema).min(1),
    usedTokens: z.number().int().nonnegative(),
    budgetTokens: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
    strategy: planStrategyDecisionSchema.optional(),
  })
  .strict();

export type PlanningResult = z.infer<typeof planningResultSchema>;
export type PlanningStatus = z.infer<typeof planningStatusSchema>;
export type PlanningReasonCode = z.infer<typeof planningReasonCodeSchema>;
