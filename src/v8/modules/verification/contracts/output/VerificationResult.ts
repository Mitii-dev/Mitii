import { z } from "zod";

import {
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_CHECK_OUTCOMES,
  VERIFICATION_DIAGNOSTIC_SEVERITIES,
  VERIFICATION_REASON_CODES,
  VERIFICATION_SCHEMA_VERSION,
  VERIFICATION_STATUSES,
} from "../../constants";

export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const verificationCheckKindSchema = z.enum(VERIFICATION_CHECK_KINDS);
export const verificationCheckOutcomeSchema = z.enum(
  VERIFICATION_CHECK_OUTCOMES,
);
export const verificationDiagnosticSeveritySchema = z.enum(
  VERIFICATION_DIAGNOSTIC_SEVERITIES,
);
export const verificationReasonCodeSchema = z.enum(VERIFICATION_REASON_CODES);

export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type VerificationCheckKind = z.infer<typeof verificationCheckKindSchema>;
export type VerificationCheckOutcome = z.infer<
  typeof verificationCheckOutcomeSchema
>;
export type VerificationDiagnosticSeverity = z.infer<
  typeof verificationDiagnosticSeveritySchema
>;
export type VerificationReasonCode = z.infer<
  typeof verificationReasonCodeSchema
>;

export const verificationDiagnosticSchema = z
  .object({
    path: z.string().min(1),
    severity: verificationDiagnosticSeveritySchema,
    message: z.string().min(1),
    startLine: z.number().int().positive().optional(),
    startColumn: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    endColumn: z.number().int().positive().optional(),
    source: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    checkId: z.string().min(1).optional(),
  })
  .strict();

export type VerificationDiagnostic = z.infer<
  typeof verificationDiagnosticSchema
>;

export const verificationCheckResultSchema = z
  .object({
    checkId: z.string().min(1),
    kind: verificationCheckKindSchema,
    projectId: z.string().min(1).optional(),
    label: z.string().min(1),
    argv: z.array(z.string().min(1)).optional(),
    evidenceSource: z.string().min(1),
    outcome: verificationCheckOutcomeSchema,
    exitCode: z.number().nullable().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    summary: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
  })
  .strict();

export type VerificationCheckResult = z.infer<
  typeof verificationCheckResultSchema
>;

export const verificationDiffInspectionSchema = z
  .object({
    reviewed: z.boolean(),
    staleStateRisk: z.boolean(),
    summary: z.string().min(1),
    changedPaths: z.array(z.string()),
    preview: z.string().optional(),
  })
  .strict();

export type VerificationDiffInspection = z.infer<
  typeof verificationDiffInspectionSchema
>;

export const verificationResultSchema = z
  .object({
    schemaVersion: z.literal(VERIFICATION_SCHEMA_VERSION),
    status: verificationStatusSchema,
    stateToken: z.string().min(1),
    affectedProjectIds: z.array(z.string()),
    checks: z.array(verificationCheckResultSchema),
    diagnostics: z.array(verificationDiagnosticSchema),
    diff: verificationDiffInspectionSchema,
    warnings: z.array(z.string()),
    reasonCodes: z.array(verificationReasonCodeSchema).min(1),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type VerificationResult = z.infer<typeof verificationResultSchema>;
