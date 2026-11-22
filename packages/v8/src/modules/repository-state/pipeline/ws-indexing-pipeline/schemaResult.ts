import {
  z,
} from "zod";

import {
  WORKSPACE_INDEXING_PIPELINE_LIMITS,
  WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION,
} from "./constants";
import {
  canonicalRelativePathSchema,
} from "./schemaShared";

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
    contentHash:
      z.string()
        .min(1)
        .optional(),
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
