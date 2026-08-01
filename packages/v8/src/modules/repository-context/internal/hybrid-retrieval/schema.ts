import {
  z,
} from "zod";

import type {
  RepoGraph,
} from "../../../repository-state/index";

import type {
  RepoMap,
} from "../../../repository-state/index";

import {
  HYBRID_RETRIEVAL_LIMITS,
  HYBRID_RETRIEVAL_SCHEMA_VERSION,
} from "./constants";

const canonicalRelativePathSchema =
  z.string()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.endsWith("/") &&
        !value.includes("\\") &&
        !value
          .split("/")
          .some(
            (segment) =>
              !segment ||
              segment === "." ||
              segment === "..",
          ),
      {
        message:
          "Expected a canonical workspace-relative path.",
      },
    );

const chunkKindSchema =
  z.enum([
    "code_symbol",
    "code_region",
    "markdown_section",
    "text",
  ]);

const retrievalEntityKindSchema =
  z.enum([
    "chunk",
    "file",
    "symbol",
  ]);

const retrievalReasonTypeSchema =
  z.enum([
    "lexical_match",
    "semantic_match",
    "repo_map_rank",
    "graph_path_match",
    "graph_symbol_match",
    "graph_import_neighbor",
    "graph_reference_neighbor",
    "reranked",
  ]);

const retrievalReasonSchema =
  z.object({
    type:
      retrievalReasonTypeSchema,
    evidence:
      z.string().min(1),
  }).strict();

const repoMapReferenceSchema =
  z.custom<RepoMap>(
    (value) =>
      typeof value ===
        "object" &&
      value !== null &&
      "schemaVersion" in value &&
      value.schemaVersion === 1 &&
      "entries" in value &&
      Array.isArray(
        value.entries,
      ),
    {
      message:
        "Expected a validated RepoMap.",
    },
  );

const repoGraphReferenceSchema =
  z.custom<RepoGraph>(
    (value) =>
      typeof value ===
        "object" &&
      value !== null &&
      "schemaVersion" in value &&
      value.schemaVersion === 1 &&
      "nodes" in value &&
      Array.isArray(
        value.nodes,
      ) &&
      "edges" in value &&
      Array.isArray(
        value.edges,
      ),
    {
      message:
        "Expected a validated RepoGraph.",
    },
  );

const uniqueStringsSchema = (
  valueSchema: z.ZodType<string>,
) =>
  z.array(valueSchema)
    .max(
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_FILTER_VALUES,
    )
    .refine(
      (values) =>
        new Set(values).size ===
        values.length,
      {
        message:
          "Values must be unique.",
      },
    );

export const hybridRetrievalInputSchema =
  z.object({
    workspace:
      z.string().min(1),
    query:
      z.string()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_QUERY_CHARACTERS,
        ),

    rootIds:
      z.array(
        z.string().min(1),
      ).optional(),
    folderPrefix:
      canonicalRelativePathSchema
        .optional(),
    filePaths:
      z.array(
        canonicalRelativePathSchema,
      ).optional(),
    kinds:
      z.array(
        chunkKindSchema,
      ).optional(),

    maximumResults:
      z.number()
        .int()
        .positive()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_RESULTS,
        )
        .optional(),
    maximumCandidatesPerSource:
      z.number()
        .int()
        .positive()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_CANDIDATES_PER_SOURCE,
        )
        .optional(),

    workspaceSnapshotId:
      z.string()
        .min(1)
        .optional(),
    codeIndexChangeToken:
      z.string()
        .min(1)
        .optional(),

    repoMap:
      repoMapReferenceSchema
        .optional(),
    repoGraph:
      repoGraphReferenceSchema
        .optional(),

    abortSignal:
      z.custom<AbortSignal>(
        (value) =>
          typeof value ===
            "object" &&
          value !== null &&
          "aborted" in value,
      ).optional(),
  }).strict();

export const normalizedHybridRetrievalRequestSchema =
  z.object({
    workspace:
      z.string().min(1),
    query:
      z.string().min(1),

    rootIds:
      uniqueStringsSchema(
        z.string().min(1),
      ),
    folderPrefix:
      canonicalRelativePathSchema
        .optional(),
    filePaths:
      uniqueStringsSchema(
        canonicalRelativePathSchema,
      ),
    kinds:
      z.array(
        chunkKindSchema,
      )
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_FILTER_VALUES,
        )
        .refine(
          (values) =>
            new Set(values).size ===
            values.length,
          {
            message:
              "Chunk kinds must be unique.",
          },
        ),

    maximumResults:
      z.number()
        .int()
        .positive()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_RESULTS,
        ),
    maximumCandidatesPerSource:
      z.number()
        .int()
        .positive()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_CANDIDATES_PER_SOURCE,
        ),

    workspaceSnapshotId:
      z.string()
        .min(1)
        .optional(),
    codeIndexChangeToken:
      z.string()
        .min(1)
        .optional(),

    repoMap:
      repoMapReferenceSchema
        .optional(),
    repoGraph:
      repoGraphReferenceSchema
        .optional(),
  }).strict();

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
      "source_truncated",
      "result_limit_reached",
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
