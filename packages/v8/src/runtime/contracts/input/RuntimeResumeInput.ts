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
      ])
      .optional(),
    /** Which suspended gate `approve`/`reject` target (default plan). */
    target: z.enum(["plan", "mutation", "grant"]).optional(),
    clarifyAnswer: z.string().optional(),
    guidance: z.string().optional(),
    /** Host Build — fingerprint of the plan being approved (freshness check). */
    approvedPlanFingerprint: z.string().min(1).optional(),
  })
  .strict();

export type RuntimeResumeInput = z.infer<typeof runtimeResumeInputSchema>;
