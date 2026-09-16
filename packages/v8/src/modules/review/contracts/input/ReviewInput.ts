import { z } from "zod";

import {
  REVIEW_EFFORTS,
  REVIEW_MODES,
  REVIEW_SCHEMA_VERSION,
} from "../../constants";
import { REVIEW_POLICY } from "../../policy";

export const reviewModeSchema = z.enum(REVIEW_MODES);
export const reviewEffortSchema = z.enum(REVIEW_EFFORTS);

export const reviewChangedFileSchema = z
  .object({
    path: z.string().min(1),
    /** Unified diff text for this file (empty for scan mode). */
    diff: z.string().default(""),
    /** Full file content when available (new files / scan). */
    content: z.string().optional(),
    insertions: z.number().int().nonnegative().default(0),
    deletions: z.number().int().nonnegative().default(0),
    isBinary: z.boolean().default(false),
    isDeleted: z.boolean().default(false),
    status: z
      .enum(["added", "modified", "deleted", "renamed", "copied", "unknown"])
      .default("unknown"),
  })
  .strict();

export const reviewFileFilterSchema = z
  .object({
    include: z.array(z.string().min(1)).max(200).default([]),
    exclude: z.array(z.string().min(1)).max(200).default([]),
  })
  .strict();

export const reviewRuleOverrideSchema = z
  .object({
    path: z.string().min(1),
    rule: z.string().min(1),
    mergeSystemRule: z.boolean().default(true),
  })
  .strict();

export const reviewRulesConfigSchema = z
  .object({
    include: z.array(z.string().min(1)).max(200).optional(),
    exclude: z.array(z.string().min(1)).max(200).optional(),
    rules: z.array(reviewRuleOverrideSchema).max(500).default([]),
  })
  .strict();

export const reviewInputSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION).default(REVIEW_SCHEMA_VERSION),
    workspaceId: z.string().min(1).optional(),
    workspaceRoot: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
    mode: reviewModeSchema.default("workspace"),
    fromRef: z.string().min(1).optional(),
    toRef: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    mergeBase: z.string().min(1).optional(),
    effort: reviewEffortSchema.default(REVIEW_POLICY.effort),
    files: z.array(reviewChangedFileSchema).max(2_000).default([]),
    filter: reviewFileFilterSchema.optional(),
    rulesConfig: reviewRulesConfigSchema.optional(),
    /** Bundled/system path→rule text map (first match wins, insertion order). */
    systemRules: z
      .array(
        z
          .object({
            pattern: z.string().min(1),
            rule: z.string().min(1),
            source: z.string().min(1).default("system"),
          })
          .strict(),
      )
      .max(500)
      .default([]),
    maxDiffTokens: z
      .number()
      .int()
      .positive()
      .max(200_000)
      .default(REVIEW_POLICY.maxDiffTokens),
    maxFilesPerGroup: z
      .number()
      .int()
      .positive()
      .max(50)
      .default(REVIEW_POLICY.maxFilesPerGroup),
    groupingMinFiles: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .default(REVIEW_POLICY.groupingMinFiles),
    groupingBundleLineThreshold: z
      .number()
      .int()
      .nonnegative()
      .max(50_000)
      .default(REVIEW_POLICY.groupingBundleLineThreshold),
    scanBatchSize: z
      .number()
      .int()
      .positive()
      .max(200)
      .default(REVIEW_POLICY.scanBatchSize),
    maxFindings: z
      .number()
      .int()
      .positive()
      .max(1_000)
      .default(REVIEW_POLICY.maxFindings),
    background: z.string().max(8_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "range" && (!value.fromRef || !value.toRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "range mode requires fromRef and toRef.",
      });
    }
    if (value.mode === "commit" && !value.commit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "commit mode requires commit.",
      });
    }
  });

export type ReviewMode = z.infer<typeof reviewModeSchema>;
export type ReviewEffort = z.infer<typeof reviewEffortSchema>;
export type ReviewChangedFile = z.infer<typeof reviewChangedFileSchema>;
export type ReviewFileFilter = z.infer<typeof reviewFileFilterSchema>;
export type ReviewRulesConfig = z.infer<typeof reviewRulesConfigSchema>;
export type ReviewInput = z.input<typeof reviewInputSchema>;
export type ReviewParsedInput = z.infer<typeof reviewInputSchema>;
