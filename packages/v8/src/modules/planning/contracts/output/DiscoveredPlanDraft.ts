import { z } from "zod";

/**
 * One-shot model draft for `discover_and_plan`, emitted after the read-only
 * discovery loop already looked. Change+Verify only — no Discover phaseHint,
 * discovery already happened.
 */
export const discoveredPlanStepSchema = z
  .object({
    phaseHint: z.enum(["change", "verify"]),
    intent: z.string().min(1).max(500),
    actionSummary: z.string().min(1).max(1_000),
    targetRefs: z.array(z.string().min(1).max(500)).max(8),
    expectedOutcome: z.string().min(1).max(500),
  })
  .strict();

export const discoveredPlanDraftSchema = z
  .object({
    objective: z.string().min(1).max(1_000).optional(),
    openQuestions: z.array(z.string().min(1).max(500)).max(8).optional(),
    steps: z.array(discoveredPlanStepSchema).max(10),
  })
  .strict();

export type DiscoveredPlanStep = z.infer<typeof discoveredPlanStepSchema>;
export type DiscoveredPlanDraft = z.infer<typeof discoveredPlanDraftSchema>;
