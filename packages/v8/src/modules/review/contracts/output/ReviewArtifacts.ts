import { z } from "zod";

import {
  REVIEW_CATEGORIES,
  REVIEW_EXCLUDE_REASONS,
  REVIEW_REASON_CODES,
  REVIEW_RECORD_SCHEMA_VERSION,
  REVIEW_RECORD_STATUSES,
  REVIEW_SCHEMA_VERSION,
  REVIEW_SEVERITIES,
  REVIEW_STATUSES,
  REVIEW_WARNING_CODES,
} from "../../constants";
import {
  reviewEffortSchema,
  reviewModeSchema,
} from "../input/ReviewInput";

export const reviewCategorySchema = z.enum(REVIEW_CATEGORIES);
export const reviewSeveritySchema = z.enum(REVIEW_SEVERITIES);
export const reviewExcludeReasonSchema = z.enum(REVIEW_EXCLUDE_REASONS);
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export const reviewRecordStatusSchema = z.enum(REVIEW_RECORD_STATUSES);
export const reviewReasonCodeSchema = z.enum(REVIEW_REASON_CODES);
export const reviewWarningCodeSchema = z.enum(REVIEW_WARNING_CODES);

export const reviewFindingSchema = z
  .object({
    findingId: z.string().min(1).optional(),
    path: z.string().min(1),
    content: z.string().min(1).max(8_000),
    existingCode: z.string().min(1).max(16_000),
    suggestionCode: z.string().max(16_000).optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    category: reviewCategorySchema.default("other"),
    severity: reviewSeveritySchema.default("low"),
    anchored: z.boolean().default(false),
    groupId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.startLine !== undefined &&
      value.endLine !== undefined &&
      value.endLine < value.startLine
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endLine must be >= startLine.",
      });
    }
  });

export const reviewFileDecisionSchema = z
  .object({
    path: z.string().min(1),
    willReview: z.boolean(),
    excludeReason: reviewExcludeReasonSchema,
    insertions: z.number().int().nonnegative().default(0),
    deletions: z.number().int().nonnegative().default(0),
    diffTokens: z.number().int().nonnegative().default(0),
    status: z.string().min(1).optional(),
  })
  .strict();

export const reviewFileGroupSchema = z
  .object({
    groupId: z.string().min(1),
    label: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1).max(50),
  })
  .strict();

export const reviewResolvedRuleSchema = z
  .object({
    path: z.string().min(1),
    pattern: z.string().min(1),
    source: z.string().min(1),
    rule: z.string().min(1),
  })
  .strict();

export const reviewRuleGroupSchema = z
  .object({
    pattern: z.string().min(1),
    source: z.string().min(1),
    rule: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const reviewWarningSchema = z
  .object({
    code: reviewWarningCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const reviewPreviewSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    status: z.literal("preview"),
    mode: reviewModeSchema,
    effort: reviewEffortSchema,
    files: z.array(reviewFileDecisionSchema),
    selectedCount: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    totalInsertions: z.number().int().nonnegative(),
    totalDeletions: z.number().int().nonnegative(),
    reasonCodes: z.array(reviewReasonCodeSchema).min(1),
    warnings: z.array(reviewWarningSchema).default([]),
  })
  .strict();

export const reviewPrepResultSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    status: z.enum(["ok", "partial", "empty"]),
    mode: reviewModeSchema,
    effort: reviewEffortSchema,
    maxReviewRounds: z.number().int().positive(),
    files: z.array(reviewFileDecisionSchema),
    groups: z.array(reviewFileGroupSchema),
    rules: z.array(reviewResolvedRuleSchema),
    ruleGroups: z.array(reviewRuleGroupSchema),
    selectedCount: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    reasonCodes: z.array(reviewReasonCodeSchema).min(1),
    warnings: z.array(reviewWarningSchema).default([]),
    background: z.string().optional(),
  })
  .strict();

export const reviewResultSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    status: reviewStatusSchema,
    mode: reviewModeSchema,
    effort: reviewEffortSchema,
    files: z.array(reviewFileDecisionSchema),
    groups: z.array(reviewFileGroupSchema),
    findings: z.array(reviewFindingSchema),
    selectedCount: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
    anchoredCount: z.number().int().nonnegative(),
    userSummary: z.string().max(4_000).optional(),
    reasonCodes: z.array(reviewReasonCodeSchema).min(1),
    warnings: z.array(reviewWarningSchema).default([]),
    recordId: z.string().min(1).optional(),
  })
  .strict();

export const reviewRecordSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_RECORD_SCHEMA_VERSION),
    recordId: z.string().min(1),
    runId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    capturedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    status: reviewRecordStatusSchema,
    mode: reviewModeSchema,
    effort: reviewEffortSchema,
    fromRef: z.string().min(1).optional(),
    toRef: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    mergeBase: z.string().min(1).optional(),
    prep: reviewPrepResultSchema.optional(),
    result: reviewResultSchema.optional(),
    groupFingerprints: z.array(z.string().min(1)).max(500).default([]),
    userSummary: z.string().max(4_000).optional(),
    reasonCodes: z.array(reviewReasonCodeSchema).min(1),
  })
  .strict();

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewFileDecision = z.infer<typeof reviewFileDecisionSchema>;
export type ReviewFileGroup = z.infer<typeof reviewFileGroupSchema>;
export type ReviewResolvedRule = z.infer<typeof reviewResolvedRuleSchema>;
export type ReviewRuleGroup = z.infer<typeof reviewRuleGroupSchema>;
export type ReviewWarning = z.infer<typeof reviewWarningSchema>;
export type ReviewPreview = z.infer<typeof reviewPreviewSchema>;
export type ReviewPrepResult = z.infer<typeof reviewPrepResultSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type ReviewRecordStatus = z.infer<typeof reviewRecordStatusSchema>;
export type ReviewReasonCode = z.infer<typeof reviewReasonCodeSchema>;
export type ReviewWarningCode = z.infer<typeof reviewWarningCodeSchema>;
export type ReviewCategory = z.infer<typeof reviewCategorySchema>;
export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;
export type ReviewExcludeReason = z.infer<typeof reviewExcludeReasonSchema>;
