import {
  z,
} from "zod";

import {
  EMBEDDING_SCHEMA_VERSION,
} from "../constants";

import {
  embeddingProfileSchema,
} from "./vectorRecordSchemas";

export const embeddingSynchronizationWarningSchema =
  z.object({
    code: z.enum([
      "missing_upsert_chunk",
      "input_truncated",
      "batch_limit_reached",
    ]),
    message:
      z.string().min(1),
    chunkId:
      z.string()
        .min(1)
        .optional(),
  }).strict();

export const embeddingSynchronizationResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        EMBEDDING_SCHEMA_VERSION,
      ),
    status: z.enum([
      "complete",
      "unchanged",
      "partial",
      "cancelled",
    ]),
    workspace:
      z.string().min(1),
    rootId:
      z.string().min(1),
    profile:
      embeddingProfileSchema,
    initialTextRevision:
      z.number()
        .int()
        .nonnegative(),
    finalTextRevision:
      z.number()
        .int()
        .nonnegative(),
    latestTextRevision:
      z.number()
        .int()
        .nonnegative(),
    warnings:
      z.array(
        embeddingSynchronizationWarningSchema,
      ),
    statistics:
      z.object({
        changeBatchesRead:
          z.number()
            .int()
            .nonnegative(),
        writeBatchesApplied:
          z.number()
            .int()
            .nonnegative(),
        changesRead:
          z.number()
            .int()
            .nonnegative(),
        chunksEmbedded:
          z.number()
            .int()
            .nonnegative(),
        vectorsDeleted:
          z.number()
            .int()
            .nonnegative(),
        providerCalls:
          z.number()
            .int()
            .nonnegative(),
        truncatedInputs:
          z.number()
            .int()
            .nonnegative(),
      }).strict(),
  }).strict()
    .superRefine(
      (result, context) => {
        if (
          result.finalTextRevision <
          result.initialTextRevision
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["finalTextRevision"],
            message:
              "Synchronization cannot move the Text Index checkpoint backwards.",
          });
        }

        if (
          result.finalTextRevision >
          result.latestTextRevision
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["finalTextRevision"],
            message:
              "Final revision cannot exceed the observed latest revision.",
          });
        }

        if (
          (result.status ===
            "complete" ||
            result.status ===
              "unchanged") &&
          result.finalTextRevision !==
            result.latestTextRevision
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["status"],
            message:
              "Complete or unchanged synchronization must reach the latest revision.",
          });
        }

        if (
          result.status ===
            "unchanged" &&
          result.initialTextRevision !==
            result.finalTextRevision
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["status"],
            message:
              "Unchanged synchronization cannot advance the revision.",
          });
        }

        if (
          result.status ===
            "partial" &&
          result.finalTextRevision >=
            result.latestTextRevision
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["status"],
            message:
              "Partial synchronization must remain behind the latest revision.",
          });
        }
      },
    );
