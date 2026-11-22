import {
  z,
} from "zod";

import {
  workspaceSnapshotSchema,
} from "../../internal/workspace/schema";

import {
  WORKSPACE_INDEXING_PIPELINE_LIMITS,
} from "./constants";
import {
  canonicalRelativePathSchema,
} from "./schemaShared";

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
    finalizeOnly:
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
