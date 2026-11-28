import { z } from "zod";

import { verificationBaselineSnapshotSchema } from "./VerificationBaselineSnapshot";

/**
 * Runtime-facing verification request (§12 / S12-CONTRACT).
 * Decision.verification + route/grant drive policy; modules own check execution.
 */

export const verificationOnFailureSchema = z.enum([
  "retry",
  "report",
  "block",
]);

export const verificationCheckKindSchema = z.enum([
  "diagnostics",
  "tests",
  "typecheck",
  "lint",
  "build",
  "diff_review",
  "behavior",
]);

export const verificationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    route: z.string().optional(),
    required: z.boolean().default(false),
    checks: z.array(verificationCheckKindSchema).default([]),
    allowUnavailable: z.boolean().default(true),
    onFailure: verificationOnFailureSchema.default("report"),
    /** Repair passes already consumed this finish phase. */
    repairPass: z.number().int().nonnegative().default(0),
    maxRepairPasses: z.number().int().nonnegative().default(2),
    changedPaths: z.array(z.string()).max(64).optional(),
    workspaceRoot: z.string().optional(),
    /** Pre-mutation baseline (S12-BASELINE). */
    baselineSnapshot: verificationBaselineSnapshotSchema.optional(),
    /** Verify-phase budgets (S12-TIME) — separate from mutate-loop. */
    budgets: z
      .object({
        verifyWallMs: z.number().int().positive().default(120_000),
        perCheckTimeoutMs: z.number().int().positive().default(30_000),
        maxChecks: z.number().int().positive().default(6),
      })
      .strict()
      .optional(),
  })
  .strict();

export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
export type VerificationOnFailure = z.infer<typeof verificationOnFailureSchema>;
export type VerificationCheckKind = z.infer<typeof verificationCheckKindSchema>;
