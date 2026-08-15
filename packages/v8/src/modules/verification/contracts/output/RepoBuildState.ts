import { z } from "zod";

import { verificationChangeScopeSchema } from "../input/VerificationInput";
import {
  verificationCheckResultSchema,
  verificationDiagnosticSchema,
  verificationReasonCodeSchema,
} from "./VerificationResult";

export const REPO_BUILD_STATE_SCHEMA_VERSION = 1 as const;

export const repoBuildStateSchema = z
  .object({
    schemaVersion: z.literal(REPO_BUILD_STATE_SCHEMA_VERSION),
    capturedAt: z.string().datetime(),
    phase: z.enum(["before", "after"]),
    scope: z
      .object({
        workspaceRoot: z.string().min(1),
        folderPrefixes: z.array(z.string().min(1)).default([]),
        projectIds: z.array(z.string().min(1)).default([]),
        changeScope: verificationChangeScopeSchema,
      })
      .strict(),
    checks: z.array(verificationCheckResultSchema).max(32),
    diagnostics: z.array(verificationDiagnosticSchema).max(500),
    summary: z
      .object({
        errorCount: z.number().int().nonnegative(),
        warningCount: z.number().int().nonnegative(),
        failedCheckIds: z.array(z.string().min(1)),
      })
      .strict(),
    reasonCodes: z.array(verificationReasonCodeSchema).default([]),
  })
  .strict();

export type RepoBuildState = z.infer<typeof repoBuildStateSchema>;

export const repoBuildStateComparisonReasonSchema = z.enum([
  "errors_cleared",
  "errors_remaining",
  "new_errors_introduced",
  "warnings_remaining",
  "checks_still_failing",
  "no_before_state",
]);

export const repoBuildStateComparisonSchema = z
  .object({
    beforeErrorCount: z.number().int().nonnegative(),
    afterErrorCount: z.number().int().nonnegative(),
    clearedErrorCount: z.number().int().nonnegative(),
    newErrorCount: z.number().int().nonnegative(),
    remainingErrorCount: z.number().int().nonnegative(),
    failedCheckIdsBefore: z.array(z.string().min(1)),
    failedCheckIdsAfter: z.array(z.string().min(1)),
    reasonCodes: z.array(repoBuildStateComparisonReasonSchema),
  })
  .strict();

export type RepoBuildStateComparison = z.infer<
  typeof repoBuildStateComparisonSchema
>;
export type RepoBuildStateComparisonReason = z.infer<
  typeof repoBuildStateComparisonReasonSchema
>;
