import {
  z,
} from "zod";

import {
  CHUNKING_PATTERNS,
  CHUNKING_SCHEMA_VERSION,
} from "./constants";

export const chunkingRelativePathSchema =
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

export const chunkContentHashSchema =
  z.string()
    .regex(
      CHUNKING_PATTERNS.CONTENT_HASH,
    );

export const chunkSchema =
  z.object({
    id:
      z.string().min(1),

    sourceId:
      z.string().min(1),

    rootId:
      z.string().min(1),

    relativePath:
      chunkingRelativePathSchema,

    strategyId:
      z.string().min(1),

    ordinal:
      z.number()
        .int()
        .nonnegative(),

    kind: z.enum([
      "code_symbol",
      "code_region",
      "markdown_section",
      "text",
    ]),

    content:
      z.string().min(1),

    sourceContentHash:
      chunkContentHashSchema,

    contentHash:
      chunkContentHashSchema,

    tokenEstimate:
      z.number()
        .int()
        .positive(),

    startOffset:
      z.number()
        .int()
        .nonnegative(),

    endOffset:
      z.number()
        .int()
        .positive(),

    startLine:
      z.number()
        .int()
        .positive(),

    endLine:
      z.number()
        .int()
        .positive(),

    title:
      z.string()
        .min(1)
        .optional(),

    symbolLocalId:
      z.string()
        .min(1)
        .optional(),
  })
    .strict()
    .superRefine(
      (chunk, context) => {
        if (
          chunk.endOffset <=
          chunk.startOffset
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["endOffset"],
            message:
              "endOffset must be greater than startOffset.",
          });
        }

        if (
          chunk.endLine <
          chunk.startLine
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["endLine"],
            message:
              "endLine cannot be smaller than startLine.",
          });
        }
      },
    );

export const chunkingWarningSchema =
  z.object({
    code: z.enum([
      "input_truncated",
      "input_rejected",
      "source_analysis_mismatch",
      "source_analysis_unusable",
      "strategy_failed",
      "strategy_returned_empty",
      "invalid_span",
      "duplicate_span_removed",
      "chunks_truncated",
      "cancelled",
    ]),

    message:
      z.string().min(1),

    strategyId:
      z.string()
        .min(1)
        .optional(),

    startOffset:
      z.number()
        .int()
        .nonnegative()
        .optional(),

    endOffset:
      z.number()
        .int()
        .positive()
        .optional(),
  })
    .strict()
    .superRefine(
      (warning, context) => {
        if (
          warning.startOffset !==
            undefined &&
          warning.endOffset !==
            undefined &&
          warning.endOffset <=
            warning.startOffset
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["endOffset"],
            message:
              "Warning endOffset must be greater than startOffset.",
          });
        }
      },
    );

export const chunkingStatisticsSchema =
  z.object({
    inputCharacters:
      z.number()
        .int()
        .nonnegative(),

    processedCharacters:
      z.number()
        .int()
        .nonnegative(),

    omittedCharacters:
      z.number()
        .int()
        .nonnegative(),

    inputLines:
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
  })
    .strict()
    .superRefine(
      (statistics, context) => {
        if (
          statistics
            .processedCharacters +
            statistics
              .omittedCharacters !==
          statistics.inputCharacters
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "processedCharacters",
            ],
            message:
              "Processed and omitted characters must equal inputCharacters.",
          });
        }
      },
    );

export const chunkingResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        CHUNKING_SCHEMA_VERSION,
      ),

    sourceId:
      z.string().min(1),

    rootId:
      z.string().min(1),

    relativePath:
      chunkingRelativePathSchema,

    language:
      z.string()
        .min(1)
        .optional(),

    sourceContentHash:
      chunkContentHashSchema,

    strategyId:
      z.string()
        .min(1)
        .optional(),

    status: z.enum([
      "complete",
      "partial",
      "empty",
      "cancelled",
      "rejected",
      "failed",
    ]),

    chunks:
      z.array(chunkSchema),

    warnings:
      z.array(
        chunkingWarningSchema,
      ),

    statistics:
      chunkingStatisticsSchema,
  })
    .strict()
    .superRefine(
      (result, context) => {
        if (
          result.statistics
            .emittedChunks !==
          result.chunks.length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "statistics",
              "emittedChunks",
            ],
            message:
              "emittedChunks must equal chunks.length.",
          });
        }

        const tokenTotal =
          result.chunks.reduce(
            (sum, chunk) =>
              sum +
              chunk.tokenEstimate,
            0,
          );

        if (
          result.statistics
            .estimatedTokens !==
          tokenTotal
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "statistics",
              "estimatedTokens",
            ],
            message:
              "estimatedTokens must equal the sum of chunk token estimates.",
          });
        }

        if (
          (
            result.status ===
              "empty" ||
            result.status ===
              "rejected" ||
            result.status ===
              "failed"
          ) &&
          result.chunks.length > 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["chunks"],
            message:
              `${result.status} results cannot contain chunks.`,
          });
        }

        if (
          result.status ===
            "complete" &&
          result.statistics
            .omittedCharacters > 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["status"],
            message:
              "A complete result cannot omit source characters.",
          });
        }

        const chunkIds =
          new Set<string>();

        for (
          let index = 0;
          index <
          result.chunks.length;
          index += 1
        ) {
          const chunk =
            result.chunks[index];

          if (!chunk) {
            continue;
          }

          if (
            chunkIds.has(
              chunk.id,
            )
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "chunks",
                index,
                "id",
              ],
              message:
                `Duplicate chunk ID "${chunk.id}".`,
            });
          }

          chunkIds.add(
            chunk.id,
          );

          if (
            chunk.ordinal !== index
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "chunks",
                index,
                "ordinal",
              ],
              message:
                "Chunk ordinals must be contiguous and match array order.",
            });
          }
        }
      },
    );
