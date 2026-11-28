import {
  z,
} from "zod";

import {
  EMBEDDING_SCHEMA_VERSION,
} from "../constants";

import {
  embeddingProfileSchema,
  embeddingVectorRecordSchema,
} from "./vectorRecordSchemas";

export const embeddingGenerationWarningSchema =
  z.object({
    code:
      z.literal(
        "input_truncated",
      ),
    chunkId:
      z.string().min(1),
    message:
      z.string().min(1),
  }).strict();

export const embeddingGenerationResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        EMBEDDING_SCHEMA_VERSION,
      ),
    status: z.enum([
      "complete",
      "cancelled",
    ]),
    profile:
      embeddingProfileSchema,
    records:
      z.array(
        embeddingVectorRecordSchema,
      ),
    warnings:
      z.array(
        embeddingGenerationWarningSchema,
      ),
    statistics:
      z.object({
        requestedChunks:
          z.number()
            .int()
            .nonnegative(),
        embeddedChunks:
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
          result.status ===
            "cancelled" &&
          result.records.length > 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["records"],
            message:
              "Cancelled generation must not expose partial vectors.",
          });
        }

        if (
          result.status ===
            "complete" &&
          result.records.length !==
            result.statistics
              .requestedChunks
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["records"],
            message:
              "Complete generation must return one record per requested chunk.",
          });
        }

        if (
          result.records.length !==
          result.statistics
            .embeddedChunks
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "statistics",
              "embeddedChunks",
            ],
            message:
              "embeddedChunks must equal records.length.",
          });
        }

        const ids =
          new Set<string>();

        for (
          let index = 0;
          index <
          result.records.length;
          index += 1
        ) {
          const record =
            result.records[index];

          if (!record) {
            continue;
          }

          if (
            record.profileId !==
            result.profile.id
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "records",
                index,
                "profileId",
              ],
              message:
                "Record profileId must match the generation profile.",
            });
          }

          if (
            record.vector.length !==
            result.profile
              .dimensions
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "records",
                index,
                "vector",
              ],
              message:
                "Vector dimensions must match the embedding profile.",
            });
          }

          if (
            ids.has(
              record.chunkId,
            )
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "records",
                index,
                "chunkId",
              ],
              message:
                "Generated chunk IDs must be unique.",
            });
          }

          ids.add(
            record.chunkId,
          );
        }
      },
    );
