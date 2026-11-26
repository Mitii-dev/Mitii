import { z } from "zod";

import {
  verificationCheckKindSchema,
  verificationOnFailureSchema,
} from "./VerificationRequest";

/**
 * Runtime-facing verification outcome (§12 / S12-CONTRACT).
 */

export const verificationOutcomeStatusSchema = z.enum([
  "passed",
  "failed",
  "skipped",
  "unavailable",
  "repair_requested",
  "repair_capped",
  "blocked",
]);

export const verificationOutcomeSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: verificationOutcomeStatusSchema,
    checksRun: z.array(verificationCheckKindSchema).default([]),
    onFailure: verificationOnFailureSchema.optional(),
    repairPass: z.number().int().nonnegative().default(0),
    shouldReturnToLoop: z.boolean().default(false),
    shouldSuspendContinue: z.boolean().default(false),
    summary: z.string().optional(),
    /** Introduced vs baseline, in touched scope (S12-BASELINE). */
    newRegressions: z.array(z.string()).default([]),
    /** Pre-existing signatures still present — reported, not blocking. */
    baselineLeftovers: z.array(z.string()).default([]),
    reasonCodes: z.array(z.string()).default([]),
  })
  .strict();

export type VerificationOutcome = z.infer<typeof verificationOutcomeSchema>;
export type VerificationOutcomeStatus = z.infer<
  typeof verificationOutcomeStatusSchema
>;
