import { z } from "zod";

/** Thin resume shape — expands as checkpoint carry migrates from engine. */
export const runtimeResumeInputSchema = z
  .object({
    runId: z.string().min(1),
    /** Host answer to clarification / plan / approval. */
    decision: z
      .enum([
        "continue",
        "approve",
        "reject",
        "clarify_answer",
        "expand_grant",
        "steer",
      ])
      .optional(),
    /** Which suspended gate `approve`/`reject` target (default plan). */
    target: z
      .enum([
        "plan",
        "mutation",
        "grant",
        "external",
        "conflict",
        "destructive",
        "auth",
      ])
      .optional(),
    /** Conflict resume action when target=conflict (default force on approve). */
    conflictAction: z.enum(["resync", "force", "cancel"]).optional(),
    /** Auth/dependency resume when target=auth (default connected on approve). */
    authAction: z.enum(["connected", "skip_fallback", "cancel"]).optional(),
    clarifyAnswer: z.string().optional(),
    guidance: z.string().optional(),
    /** Host Build — fingerprint of the plan being approved (freshness check). */
    approvedPlanFingerprint: z.string().min(1).optional(),
    /** S3A-STEER — patch plan without full rediscovery. */
    planSteer: z
      .object({
        objective: z.string().min(1).optional(),
        assumptions: z.array(z.string().min(1)).max(20).optional(),
        openQuestions: z.array(z.string().min(1)).max(12).optional(),
        constraints: z.array(z.string().min(1)).max(20).optional(),
        stepTargetPatches: z
          .array(
            z
              .object({
                stepId: z.string().min(1),
                targetRefs: z.array(z.string().min(1)).max(32),
              })
              .strict(),
          )
          .max(32)
          .optional(),
        stepTextPatches: z
          .array(
            z
              .object({
                stepId: z.string().min(1),
                intent: z.string().min(1).optional(),
                actionSummary: z.string().min(1).optional(),
                expectedOutcome: z.string().min(1).optional(),
              })
              .strict(),
          )
          .max(32)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RuntimeResumeInput = z.infer<typeof runtimeResumeInputSchema>;
