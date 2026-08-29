import { z } from "zod";

/**
 * Capped preflight-diagnostic hint fed into intent classification.
 * Evidence only — classification still owns the intent decision, and this
 * never carries route/grant choices (those stay Decision Policy's job).
 */
export const diagnosticSummaryEntrySchema = z
  .object({
    path: z.string().min(1).max(1_000),
    code: z.string().min(1).max(120).optional(),
    message: z.string().min(1).max(300),
  })
  .strict();

export const diagnosticSummarySchema = z
  .object({
    errorCount: z.number().int().nonnegative(),
    inScopeErrorCount: z.number().int().nonnegative(),
    diagnostics: z.array(diagnosticSummaryEntrySchema).max(12),
  })
  .strict();

export type DiagnosticSummaryEntry = z.infer<typeof diagnosticSummaryEntrySchema>;
export type DiagnosticSummary = z.infer<typeof diagnosticSummarySchema>;
