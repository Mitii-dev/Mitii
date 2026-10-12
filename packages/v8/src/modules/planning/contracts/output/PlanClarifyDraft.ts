import { z } from "zod";

export const planClarifyOptionSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(200),
    detail: z.string().min(1).max(500).optional(),
  })
  .strict();

/**
 * Findings + scope-fork payload for Plan clarify (not a Change skeleton).
 */
export const planClarifyDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    findings: z.array(z.string().min(1).max(500)).min(1).max(8),
    scopeOptions: z.array(planClarifyOptionSchema).min(2).max(5),
    deliveryOptions: z.array(planClarifyOptionSchema).max(5).optional(),
    replyHint: z.string().min(1).max(300).optional(),
  })
  .strict();

export type PlanClarifyOption = z.infer<typeof planClarifyOptionSchema>;
export type PlanClarifyDraft = z.infer<typeof planClarifyDraftSchema>;
