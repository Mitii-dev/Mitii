import { z } from "zod";

import { PLAN_STRATEGIES } from "../../constants";

export const planStrategySchema = z.enum(PLAN_STRATEGIES);

export const planStrategyDecisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    strategy: planStrategySchema,
    rationale: z.string().min(1).max(500),
    confidence: z.number().min(0).max(1).optional(),
    skipDiscover: z.boolean(),
    useBuildEvidence: z.boolean(),
  })
  .strict();

export type PlanStrategy = z.infer<typeof planStrategySchema>;
export type PlanStrategyDecision = z.infer<
  typeof planStrategyDecisionSchema
>;
