import { z } from "zod";

/**
 * Lightweight verify baseline (S12-BASELINE).
 * Prefer host/cache/cheap diagnostics — never a heavy suite just to baseline.
 */

export const verificationBaselineSourceSchema = z.enum([
  "host_diagnostics",
  "pin",
  "empty",
]);

export const verificationBaselineSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    capturedAt: z.string().min(1),
    source: verificationBaselineSourceSchema,
    /** Stable diagnostic / failing-check identity strings. */
    signatures: z.array(z.string().min(1)).max(256).default([]),
    /** Paths in scope when baseline was taken (dirty / focused). */
    scopePaths: z.array(z.string().min(1)).max(64).default([]),
  })
  .strict();

export type VerificationBaselineSnapshot = z.infer<
  typeof verificationBaselineSnapshotSchema
>;
export type VerificationBaselineSource = z.infer<
  typeof verificationBaselineSourceSchema
>;
