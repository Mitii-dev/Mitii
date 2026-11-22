import {
  z,
} from "zod";

import {
  HYBRID_RETRIEVAL_SCHEMA_VERSION,
} from "../constants";

import {
  hybridRetrievalCandidateSchema,
} from "./candidateSchemas";

const sourceReportSchema =
  z.object({
    sourceId:
      z.string().min(1),
    status: z.enum([
      "complete",
      "empty",
      "skipped",
      "failed",
      "cancelled",
    ]),
    required:
      z.boolean(),
    weight:
      z.number()
        .positive()
        .finite(),
    candidateCount:
      z.number()
        .int()
        .nonnegative(),
    truncated:
      z.boolean(),
    warningCount:
      z.number()
        .int()
        .nonnegative(),
    error:
      z.string()
        .min(1)
        .optional(),
  }).strict();

export const hybridRetrievalWarningSchema =
  z.object({
    code: z.enum([
      "query_truncated",
      "duplicate_filter_removed",
      "source_failed",
      "required_source_unavailable",
      "optional_source_unavailable",
      "source_timeout",
      "source_truncated",
      "result_limit_reached",
      "modality_quota_applied",
      "failure_policy_unsatisfied",
      "minimum_sources_unsatisfied",
      "reranker_failed",
      "reranker_incomplete",
    ]),
    message:
      z.string().min(1),
    sourceId:
      z.string()
        .min(1)
        .optional(),
  }).strict();

export const retrievalRerankerResultSchema =
  z.object({
    scores:
      z.array(
        z.object({
          key:
            z.string().min(1),
          score:
            z.number()
              .min(0)
              .max(1),
          reason:
            z.string()
              .min(1)
              .optional(),
        }).strict(),
      )
        .refine(
          (scores) =>
            new Set(
              scores.map(
                (score) =>
                  score.key,
              ),
            ).size ===
            scores.length,
          {
            message:
              "Reranker score keys must be unique.",
          },
        ),
  }).strict();

export const hybridRetrievalResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        HYBRID_RETRIEVAL_SCHEMA_VERSION,
      ),
    query:
      z.string(),
    status: z.enum([
      "complete",
      "partial",
      "empty",
      "cancelled",
      "failed",
    ]),
    candidates:
      z.array(
        hybridRetrievalCandidateSchema,
      ),
    sourceReports:
      z.array(
        sourceReportSchema,
      ),
    warnings:
      z.array(
        hybridRetrievalWarningSchema,
      ),
    truncated:
      z.boolean(),
    statistics:
      z.object({
        configuredSources:
          z.number()
            .int()
            .nonnegative(),
        attemptedSources:
          z.number()
            .int()
            .nonnegative(),
        successfulSources:
          z.number()
            .int()
            .nonnegative(),
        failedSources:
          z.number()
            .int()
            .nonnegative(),
        skippedSources:
          z.number()
            .int()
            .nonnegative(),
        sourceCandidates:
          z.number()
            .int()
            .nonnegative(),
        uniqueCandidates:
          z.number()
            .int()
            .nonnegative(),
        duplicateCandidatesRemoved:
          z.number()
            .int()
            .nonnegative(),
        returnedCandidates:
          z.number()
            .int()
            .nonnegative(),
      }).strict(),
  }).strict()
    .superRefine(
      (result, context) => {
        if (
          (
            result.status ===
              "cancelled" ||
            result.status ===
              "failed" ||
            result.status ===
              "empty"
          ) &&
          result.candidates.length >
            0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["candidates"],
            message:
              "Cancelled, failed, and empty retrieval results cannot contain candidates.",
          });
        }

        if (
          result.statistics
            .configuredSources !==
          result.sourceReports.length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "statistics",
              "configuredSources",
            ],
            message:
              "configuredSources must equal sourceReports.length.",
          });
        }

        if (
          result.statistics
            .returnedCandidates !==
          result.candidates.length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "statistics",
              "returnedCandidates",
            ],
            message:
              "returnedCandidates must equal candidates.length.",
          });
        }

        const candidateKeys =
          new Set<string>();

        for (
          let index = 0;
          index <
          result.candidates.length;
          index += 1
        ) {
          const candidate =
            result.candidates[index];

          if (!candidate) {
            continue;
          }

          if (
            candidateKeys.has(
              candidate.key,
            )
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "candidates",
                index,
                "key",
              ],
              message:
                "Hybrid retrieval candidate keys must be unique.",
            });
          }

          candidateKeys.add(
            candidate.key,
          );
        }

        const sourceIds =
          new Set<string>();

        for (
          let index = 0;
          index <
          result.sourceReports.length;
          index += 1
        ) {
          const report =
            result.sourceReports[index];

          if (!report) {
            continue;
          }

          if (
            sourceIds.has(
              report.sourceId,
            )
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "sourceReports",
                index,
                "sourceId",
              ],
              message:
                "Source reports must have unique source IDs.",
            });
          }

          sourceIds.add(
            report.sourceId,
          );
        }
      },
    );
