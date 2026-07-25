import {
  z,
} from "zod";

import {
  workspaceSnapshotSchema,
} from "../workspace/schema";

import {
  WORKSPACE_INDEXING_PIPELINE_LIMITS,
  WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION,
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

const uniqueStringsSchema = (
  maximum:
    number,
) =>
  z.array(
    z.string()
      .min(1),
  )
    .max(
      maximum,
    )
    .refine(
      (values) =>
        new Set(
          values,
        ).size ===
        values.length,
      {
        message:
          "Values must be unique.",
      },
    );

const chunkingOptionsSchema =
  z.object({
    maximumInputCharacters:
      z.number()
        .int()
        .positive()
        .optional(),
    inputOverflowPolicy:
      z.enum([
        "truncate",
        "reject",
      ])
        .optional(),
    targetChunkCharacters:
      z.number()
        .int()
        .positive()
        .optional(),
    maximumChunkCharacters:
      z.number()
        .int()
        .positive()
        .optional(),
    minimumChunkCharacters:
      z.number()
        .int()
        .positive()
        .optional(),
    overlapCharacters:
      z.number()
        .int()
        .nonnegative()
        .optional(),
    boundarySearchCharacters:
      z.number()
        .int()
        .nonnegative()
        .optional(),
    maximumChunks:
      z.number()
        .int()
        .positive()
        .optional(),
    maximumTitleCharacters:
      z.number()
        .int()
        .positive()
        .optional(),
  }).strict()
    .optional();

export const workspaceIndexingPipelineInputSchema =
  z.object({
    workspace:
      z.string()
        .trim()
        .min(1)
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_WORKSPACE_CHARACTERS,
        ),
    snapshot:
      workspaceSnapshotSchema,
    indexedAt:
      z.number()
        .int()
        .nonnegative(),
    rootIds:
      uniqueStringsSchema(
        WORKSPACE_INDEXING_PIPELINE_LIMITS
          .MAXIMUM_FILTER_VALUES,
      )
        .optional(),
    filePaths:
      z.array(
        canonicalRelativePathSchema,
      )
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_FILTER_VALUES,
        )
        .refine(
          (values) =>
            new Set(
              values,
            ).size ===
            values.length,
          {
            message:
              "File paths must be unique.",
          },
        )
        .optional(),
    maximumFiles:
      z.number()
        .int()
        .positive()
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_FILES,
        )
        .optional(),
    concurrency:
      z.number()
        .int()
        .positive()
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_CONCURRENCY,
        )
        .optional(),
    maximumReportedFileResults:
      z.number()
        .int()
        .positive()
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_REPORTED_FILE_RESULTS,
        )
        .optional(),
    analysisVersion:
      z.string()
        .trim()
        .min(1)
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_VERSION_CHARACTERS,
        )
        .optional(),
    textPipelineVersion:
      z.string()
        .trim()
        .min(1)
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_VERSION_CHARACTERS,
        )
        .optional(),
    chunkingOptions:
      chunkingOptionsSchema,
    failureMode:
      z.enum([
        "best_effort",
        "fail_fast",
      ])
        .optional(),
    cleanupMissing:
      z.boolean()
        .optional(),
    synchronizeEmbeddings:
      z.boolean()
        .optional(),
    abortSignal:
      z.custom<AbortSignal>(
        (value) =>
          typeof value ===
            "object" &&
          value !== null &&
          "aborted" in value,
      )
        .optional(),
  }).strict()
    .superRefine(
      (
        input,
        context,
      ) => {
        const knownRootIds =
          new Set(
            input.snapshot
              .roots
              .map(
                (root) =>
                  root.id,
              ),
          );

        input.rootIds
          ?.forEach(
            (
              rootId,
              index,
            ) => {
              if (
                !knownRootIds
                  .has(
                    rootId,
                  )
              ) {
                context.addIssue({
                  code:
                    z.ZodIssueCode
                      .custom,
                  path: [
                    "rootIds",
                    index,
                  ],
                  message:
                    `Unknown workspace root ID "${rootId}".`,
                });
              }
            },
          );
      },
    );

const stageSchema =
  z.enum([
    "selection",
    "read",
    "analysis",
    "content_hash",
    "chunking",
    "code_index",
    "text_index",
    "cleanup",
    "embedding",
  ]);

const warningSchema =
  z.object({
    stage:
      stageSchema,
    code:
      z.enum([
        "file_policy_failed",
        "file_stage_failed",
        "cleanup_skipped",
        "cleanup_failed",
        "embedding_failed",
        "file_limit_reached",
        "file_results_truncated",
        "cancelled",
      ]),
    message:
      z.string()
        .min(1),
    rootId:
      z.string()
        .min(1)
        .optional(),
    relativePath:
      canonicalRelativePathSchema
        .optional(),
  }).strict();

const fileResultSchema =
  z.object({
    rootId:
      z.string()
        .min(1),
    relativePath:
      canonicalRelativePathSchema,
    sourceId:
      z.string()
        .min(1),
    status:
      z.enum([
        "complete",
        "partial",
        "failed",
        "cancelled",
      ]),
    analysisStatus:
      z.enum([
        "complete",
        "partial",
        "unsupported",
        "failed",
      ])
        .optional(),
    analysisWarnings:
      z.number()
        .int()
        .nonnegative(),
    chunkingStatus:
      z.enum([
        "complete",
        "partial",
        "empty",
        "cancelled",
        "rejected",
        "failed",
      ])
        .optional(),
    chunkingWarnings:
      z.number()
        .int()
        .nonnegative(),
    emittedChunks:
      z.number()
        .int()
        .nonnegative(),
    estimatedTokens:
      z.number()
        .int()
        .nonnegative(),
    codeIndexStatus:
      z.enum([
        "indexed",
        "metadata_refreshed",
        "unchanged",
        "unsupported",
        "analysis_failed",
        ])
        .optional(),
    codeIndexChanged:
      z.boolean(),
    textIndexStatus:
      z.enum([
        "indexed",
        "metadata_refreshed",
        "unchanged",
        "empty_indexed",
        "cancelled",
        "not_indexable",
        ])
        .optional(),
    textIndexChanged:
      z.boolean(),
    warnings:
      z.array(
        warningSchema,
      )
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_WARNINGS,
        ),
  }).strict();

const rootResultSchema =
  z.object({
    rootId:
      z.string()
        .min(1),
    status:
      z.enum([
        "complete",
        "partial",
        "skipped",
        "cancelled",
      ]),
    cleanupPerformed:
      z.boolean(),
    codeIndexRemovedFiles:
      z.number()
        .int()
        .nonnegative(),
    textIndexRemovedDocuments:
      z.number()
        .int()
        .nonnegative(),
    textIndexRemovedChunks:
      z.number()
        .int()
        .nonnegative(),
    codeIndexRevision:
      z.number()
        .int()
        .nonnegative()
        .optional(),
    embeddingStatus:
      z.enum([
        "complete",
        "unchanged",
        "partial",
        "cancelled",
      ])
        .optional(),
    embeddingProfileId:
      z.string()
        .min(1)
        .optional(),
    initialTextRevision:
      z.number()
        .int()
        .nonnegative()
        .optional(),
    finalTextRevision:
      z.number()
        .int()
        .nonnegative()
        .optional(),
    latestTextRevision:
      z.number()
        .int()
        .nonnegative()
        .optional(),
    embeddedChunks:
      z.number()
        .int()
        .nonnegative(),
    vectorsDeleted:
      z.number()
        .int()
        .nonnegative(),
    warnings:
      z.array(
        warningSchema,
      )
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_WARNINGS,
        ),
  }).strict();

const statisticsSchema =
  z.object({
    availableFiles:
      z.number()
        .int()
        .nonnegative(),
    selectedFiles:
      z.number()
        .int()
        .nonnegative(),
    skippedFiles:
      z.number()
        .int()
        .nonnegative(),
    processedFiles:
      z.number()
        .int()
        .nonnegative(),
    completeFiles:
      z.number()
        .int()
        .nonnegative(),
    partialFiles:
      z.number()
        .int()
        .nonnegative(),
    failedFiles:
      z.number()
        .int()
        .nonnegative(),
    cancelledFiles:
      z.number()
        .int()
        .nonnegative(),
    analysisFailures:
      z.number()
        .int()
        .nonnegative(),
    emittedChunks:
      z.number()
        .int()
        .nonnegative(),
    estimatedTokens:
      z.number()
        .int()
        .nonnegative(),
    codeIndexUpdates:
      z.number()
        .int()
        .nonnegative(),
    textIndexUpdates:
      z.number()
        .int()
        .nonnegative(),
    embeddedChunks:
      z.number()
        .int()
        .nonnegative(),
    removedCodeIndexFiles:
      z.number()
        .int()
        .nonnegative(),
    removedTextIndexDocuments:
      z.number()
        .int()
        .nonnegative(),
    removedTextIndexChunks:
      z.number()
        .int()
        .nonnegative(),
    reportedFileResults:
      z.number()
        .int()
        .nonnegative(),
  }).strict();

export const workspaceIndexingPipelineResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION,
      ),
    workspace:
      z.string()
        .min(1),
    workspaceSnapshotId:
      z.string()
        .min(1),
    indexedAt:
      z.number()
        .int()
        .nonnegative(),
    status:
      z.enum([
        "complete",
        "partial",
        "empty",
        "failed",
        "cancelled",
      ]),
    fileResults:
      z.array(
        fileResultSchema,
      )
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_REPORTED_FILE_RESULTS,
        ),
    fileResultsTruncated:
      z.boolean(),
    rootResults:
      z.array(
        rootResultSchema,
      ),
    warnings:
      z.array(
        warningSchema,
      )
        .max(
          WORKSPACE_INDEXING_PIPELINE_LIMITS
            .MAXIMUM_WARNINGS,
        ),
    cleanupAllowed:
      z.boolean(),
    statistics:
      statisticsSchema,
  }).strict()
    .superRefine(
      (
        result,
        context,
      ) => {
        if (
          result.statistics
            .reportedFileResults !==
          result.fileResults
            .length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "statistics",
              "reportedFileResults",
            ],
            message:
              "reportedFileResults must equal fileResults.length.",
          });
        }

        const processedByStatus =
          result.statistics
            .completeFiles +
          result.statistics
            .partialFiles +
          result.statistics
            .failedFiles +
          result.statistics
            .cancelledFiles;

        if (
          processedByStatus !==
          result.statistics
            .processedFiles
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "statistics",
              "processedFiles",
            ],
            message:
              "processedFiles must equal the sum of terminal file statuses.",
          });
        }

        const fileKeys =
          new Set<string>();

        result.fileResults
          .forEach(
            (
              file,
              index,
            ) => {
              const key =
                `${file.rootId}\u0000${file.relativePath}`;

              if (
                fileKeys.has(
                  key,
                )
              ) {
                context.addIssue({
                  code:
                    z.ZodIssueCode
                      .custom,
                  path: [
                    "fileResults",
                    index,
                  ],
                  message:
                    "File results must be unique.",
                });
              }

              fileKeys.add(
                key,
              );
            },
          );

        const rootIds =
          new Set<string>();

        result.rootResults
          .forEach(
            (
              root,
              index,
            ) => {
              if (
                rootIds.has(
                  root.rootId,
                )
              ) {
                context.addIssue({
                  code:
                    z.ZodIssueCode
                      .custom,
                  path: [
                    "rootResults",
                    index,
                    "rootId",
                  ],
                  message:
                    "Root results must be unique.",
                });
              }

              if (
                !result
                  .cleanupAllowed &&
                root
                  .cleanupPerformed
              ) {
                context.addIssue({
                  code:
                    z.ZodIssueCode
                      .custom,
                  path: [
                    "rootResults",
                    index,
                    "cleanupPerformed",
                  ],
                  message:
                    "Cleanup cannot run when cleanupAllowed is false.",
                });
              }

              rootIds.add(
                root.rootId,
              );
            },
          );
      },
    );
