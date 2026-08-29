import { z } from "zod";

export const runEvidenceIssueStatusSchema = z.enum([
  "found",
  "fixing",
  "fixed",
  "remaining",
  "superseded",
]);

export const runEvidenceIssueSchema = z
  .object({
    id: z.string().min(1).max(120),
    source: z.string().min(1).max(120),
    path: z.string().min(1).max(1_000).optional(),
    message: z.string().min(1).max(800),
    code: z.string().min(1).max(120).optional(),
    status: runEvidenceIssueStatusSchema,
    linkedPlanStepId: z.string().min(1).max(120).optional(),
    verificationEvidence: z.string().min(1).max(300).optional(),
  })
  .strict();

export const runEvidenceDiscoverySchema = z
  .object({
    target: z.string().min(1).max(1_000),
    filesRead: z.array(z.string().min(1).max(1_000)).max(80).default([]),
    searches: z.array(z.string().min(1).max(1_000)).max(80).default([]),
    commands: z.array(z.string().min(1).max(500)).max(32).default([]),
    skipped: z.array(z.string().min(1).max(500)).max(32).default([]),
    capacity: z
      .object({
        fileBudget: z.number().int().nonnegative(),
        searchBudget: z.number().int().nonnegative(),
        toolCallBudget: z.number().int().nonnegative(),
        filesRead: z.number().int().nonnegative(),
        searchesRun: z.number().int().nonnegative(),
        toolCallsUsed: z.number().int().nonnegative(),
      })
      .strict(),
    stopReason: z.string().min(1).max(500),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    surfaceCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const runEvidencePlanStepSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(500),
    targetRefs: z.array(z.string().min(1).max(500)).max(32).default([]),
    evidenceRefs: z.array(z.string().min(1).max(500)).max(32).default([]),
    verification: z.string().min(1).max(500).optional(),
    status: z.enum(["pending", "active", "done", "skipped"]).default("pending"),
  })
  .strict();

export const runEvidencePlanSchema = z
  .object({
    objective: z.string().min(1).max(1_000),
    stepCount: z.number().int().nonnegative(),
    steps: z.array(runEvidencePlanStepSchema).max(80).default([]),
    evidenceLinkedStepCount: z.number().int().nonnegative(),
  })
  .strict();

export const runEvidenceLedgerEntrySchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: z.enum(["discovery", "plan", "edit", "verification", "tool", "stop"]),
    summary: z.string().min(1).max(800),
    status: z.string().min(1).max(80).optional(),
    toolName: z.string().min(1).max(120).optional(),
    planStepId: z.string().min(1).max(120).optional(),
    issueIds: z.array(z.string().min(1).max(120)).max(20).default([]),
    paths: z.array(z.string().min(1).max(1_000)).max(40).default([]),
    at: z.string().datetime().optional(),
  })
  .strict();

export const runEvidenceVerificationSchema = z
  .object({
    status: z.string().min(1).max(80),
    beforeErrorCount: z.number().int().nonnegative().optional(),
    afterErrorCount: z.number().int().nonnegative().optional(),
    clearedErrorCount: z.number().int().nonnegative().optional(),
    remainingIssueCount: z.number().int().nonnegative().optional(),
    checks: z
      .array(
        z
          .object({
            checkId: z.string().min(1).max(120),
            kind: z.string().min(1).max(80),
            outcome: z.string().min(1).max(80),
            summary: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    stopReason: z.string().min(1).max(500).optional(),
  })
  .strict();

export const runEvidenceSchema = z
  .object({
    discovery: runEvidenceDiscoverySchema.optional(),
    issues: z.array(runEvidenceIssueSchema).max(500).default([]),
    plan: runEvidencePlanSchema.optional(),
    ledger: z.array(runEvidenceLedgerEntrySchema).max(500).default([]),
    verification: runEvidenceVerificationSchema.optional(),
    finalStopReason: z.string().min(1).max(500).optional(),
  })
  .strict();

export type RunEvidence = z.infer<typeof runEvidenceSchema>;
export type RunEvidenceIssue = z.infer<typeof runEvidenceIssueSchema>;
export type RunEvidenceIssueStatus = z.infer<
  typeof runEvidenceIssueStatusSchema
>;
