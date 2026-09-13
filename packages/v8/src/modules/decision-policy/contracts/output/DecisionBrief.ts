import { z } from "zod";

/**
 * Worker-facing decision brief. Advisory only — never changes route/grant.
 */
export const decisionBriefSchema = z
  .object({
    mission: z.string().min(1).max(500),
    routeIntent: z.string().min(1).max(300),
    mustDo: z.array(z.string().min(1).max(300)).max(10),
    mustNotDo: z.array(z.string().min(1).max(300)).max(10),
    evidenceNeeded: z.array(z.string().min(1).max(300)).max(10),
    verification: z.array(z.string().min(1).max(300)).max(10),
    openRisks: z.array(z.string().min(1).max(300)).max(10),
    authorityNote: z.string().min(1).max(400),
  })
  .strict();

export type DecisionBrief = z.infer<typeof decisionBriefSchema>;
