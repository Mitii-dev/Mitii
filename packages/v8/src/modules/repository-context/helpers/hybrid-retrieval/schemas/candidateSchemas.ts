import {
  z,
} from "zod";

import {
  canonicalRelativePathSchema,
  retrievalEntityKindSchema,
  retrievalReasonSchema,
} from "./primitiveSchemas";

const retrievalCandidateBaseSchema =
  z.object({
    entityKind:
      retrievalEntityKindSchema,
    rootId:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    chunkId:
      z.string()
        .min(1)
        .optional(),
    symbolId:
      z.string()
        .min(1)
        .optional(),
    startLine:
      z.number()
        .int()
        .positive()
        .optional(),
    endLine:
      z.number()
        .int()
        .positive()
        .optional(),
    title:
      z.string()
        .min(1)
        .optional(),
    preview:
      z.string()
        .min(1)
        .optional(),
    contentHash:
      z.string()
        .min(1)
        .optional(),
    tokenEstimate:
      z.number()
        .int()
        .positive()
        .optional(),
  }).strict();

export const retrievalCandidateSchema =
  retrievalCandidateBaseSchema
    .extend({
    sourceScore:
      z.number()
        .min(0)
        .max(1),
    reasons:
      z.array(
        retrievalReasonSchema,
      ).min(1),
    })
    .superRefine(
      (candidate, context) => {
        if (
          candidate.entityKind ===
            "chunk" &&
          !candidate.chunkId
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["chunkId"],
            message:
              "Chunk candidates require chunkId.",
          });
        }

        if (
          candidate.entityKind ===
            "symbol" &&
          !candidate.symbolId
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["symbolId"],
            message:
              "Symbol candidates require symbolId.",
          });
        }

        if (
          candidate.startLine !==
            undefined &&
          candidate.endLine !==
            undefined &&
          candidate.endLine <
            candidate.startLine
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["endLine"],
            message:
              "endLine must be greater than or equal to startLine.",
          });
        }
      },
    );

export const retrievalSourceResultSchema =
  z.object({
    status: z.enum([
      "complete",
      "empty",
      "cancelled",
      "unavailable",
    ]),
    candidates:
      z.array(
        retrievalCandidateSchema,
      ),
    truncated:
      z.boolean(),
    warnings:
      z.array(
        z.object({
          code: z.enum([
            "source_limit_reached",
            "query_embedding_truncated",
            "graph_node_scan_limit_reached",
            "graph_edge_scan_limit_reached",
            "upstream_warning",
          ]),
          message:
            z.string().min(1),
        }).strict(),
      ),
  }).strict()
    .refine(
      (result) =>
        result.status ===
          "complete" ||
        result.candidates.length ===
          0,
      {
        path: ["candidates"],
        message:
          "Only complete source results can contain candidates.",
      },
    );

const retrievalContributionSchema =
  z.object({
    sourceId:
      z.string().min(1),
    sourceRank:
      z.number()
        .int()
        .positive(),
    sourceScore:
      z.number()
        .min(0)
        .max(1),
    sourceWeight:
      z.number()
        .positive()
        .finite(),
    reciprocalRankScore:
      z.number()
        .nonnegative()
        .finite(),
    reasons:
      z.array(
        retrievalReasonSchema,
      ).min(1),
  }).strict();

export const hybridRetrievalCandidateSchema =
  retrievalCandidateBaseSchema
    .extend({
      key:
        z.string().min(1),
      reasons:
        z.array(
          retrievalReasonSchema,
        ).min(1),
      fusedScore:
        z.number()
          .min(0)
          .max(1),
      rerankerScore:
        z.number()
          .min(0)
          .max(1)
          .optional(),
      score:
        z.number()
          .min(0)
          .max(1),
      matchedSourceCount:
        z.number()
          .int()
          .positive(),
      contributions:
        z.array(
          retrievalContributionSchema,
        ).min(1),
    })
    .superRefine(
      (candidate, context) => {
        if (
          candidate.entityKind ===
            "chunk" &&
          !candidate.chunkId
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["chunkId"],
            message:
              "Chunk candidates require chunkId.",
          });
        }

        if (
          candidate.entityKind ===
            "symbol" &&
          !candidate.symbolId
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["symbolId"],
            message:
              "Symbol candidates require symbolId.",
          });
        }

        if (
          candidate.startLine !==
            undefined &&
          candidate.endLine !==
            undefined &&
          candidate.endLine <
            candidate.startLine
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["endLine"],
            message:
              "endLine must be greater than or equal to startLine.",
          });
        }

        const sourceIds =
          new Set(
            candidate
              .contributions
              .map(
                (item) =>
                  item.sourceId,
              ),
          );

        if (
          sourceIds.size !==
          candidate
            .contributions
            .length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["contributions"],
            message:
              "Candidate contributions must have unique source IDs.",
          });
        }

        if (
          candidate
            .matchedSourceCount !==
          sourceIds.size
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["matchedSourceCount"],
            message:
              "matchedSourceCount must equal the number of unique source contributions.",
          });
        }
      },
    );
