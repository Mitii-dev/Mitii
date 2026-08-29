import { z } from "zod";

import {
  VERIFICATION_RECORD_REASON_CODES,
  VERIFICATION_RECORD_SCHEMA_VERSION,
  VERIFICATION_RECORD_STATUSES,
} from "../../constants";
import {
  repoBuildStateComparisonSchema,
  repoBuildStateSchema,
} from "./RepoBuildState";
import { verificationResultSchema } from "./VerificationResult";

export const verificationRecordStatusSchema = z.enum(
  VERIFICATION_RECORD_STATUSES,
);
export const verificationRecordReasonCodeSchema = z.enum(
  VERIFICATION_RECORD_REASON_CODES,
);

export type VerificationRecordStatus = z.infer<
  typeof verificationRecordStatusSchema
>;
export type VerificationRecordReasonCode = z.infer<
  typeof verificationRecordReasonCodeSchema
>;

/**
 * Durable verification artifact. Lives outside the model transcript so
 * interrupt, compaction, and a later "fix those" turn can reload it.
 */
export const verificationRecordSchema = z
  .object({
    schemaVersion: z.literal(VERIFICATION_RECORD_SCHEMA_VERSION),
    recordId: z.string().min(1),
    runId: z.string().min(1),
    requestId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    capturedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    status: verificationRecordStatusSchema,
    before: repoBuildStateSchema.optional(),
    after: repoBuildStateSchema.optional(),
    comparison: repoBuildStateComparisonSchema.optional(),
    verification: verificationResultSchema.optional(),
    changedFiles: z.array(z.string().min(1)).max(200).default([]),
    checkIds: z.array(z.string().min(1)).max(64).default([]),
    userSummary: z.string().min(1).max(4_000).optional(),
    retry: z
      .object({
        kind: z.literal("fix_remaining"),
        recordId: z.string().min(1),
      })
      .strict()
      .optional(),
    reasonCodes: z.array(verificationRecordReasonCodeSchema).min(1),
  })
  .strict();

export type VerificationRecord = z.infer<typeof verificationRecordSchema>;
