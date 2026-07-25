import {
  z,
} from "zod";

import {
  EMBEDDING_LIMITS,
  EMBEDDING_PATTERNS,
  EMBEDDING_SCHEMA_VERSION,
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

const finiteVectorSchema =
  z.array(
    z.number().finite(),
  ).min(1);

export const embeddingProfileSchema =
  z.object({
    id:
      z.string()
        .min(1)
        .max(
          EMBEDDING_LIMITS
            .MAXIMUM_PROFILE_ID_CHARACTERS,
        )
        .regex(
          EMBEDDING_PATTERNS
            .PROFILE_ID,
        ),

    providerId:
      z.string()
        .min(1)
        .max(
          EMBEDDING_LIMITS
            .MAXIMUM_PROVIDER_ID_CHARACTERS,
        ),

    modelId:
      z.string()
        .min(1)
        .max(
          EMBEDDING_LIMITS
            .MAXIMUM_MODEL_ID_CHARACTERS,
        ),

    dimensions:
      z.number()
        .int()
        .min(
          EMBEDDING_LIMITS
            .MINIMUM_DIMENSIONS,
        )
        .max(
          EMBEDDING_LIMITS
            .MAXIMUM_DIMENSIONS,
        ),

    normalized:
      z.boolean(),
  }).strict();

export const embeddingVectorRecordSchema =
  z.object({
    chunkId:
      z.string().min(1),

    rootId:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,

    kind: z.enum([
      "code_symbol",
      "code_region",
      "markdown_section",
      "text",
    ]),
    ordinal:
      z.number()
        .int()
        .nonnegative(),

    contentHash:
      z.string().regex(
        EMBEDDING_PATTERNS
          .CONTENT_HASH,
      ),
    tokenEstimate:
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

    profileId:
      z.string()
        .min(1)
        .regex(
          EMBEDDING_PATTERNS
            .PROFILE_ID,
        ),
    vector:
      finiteVectorSchema,
  }).strict()
    .refine(
      (record) =>
        record.endLine >=
        record.startLine,
      {
        path: ["endLine"],
        message:
          "endLine must be greater than or equal to startLine.",
      },
    );

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

export const embeddingChangePlanSchema =
  z.object({
    upsertChunkIds:
      z.array(
        z.string().min(1),
      ),
    deleteChunkIds:
      z.array(
        z.string().min(1),
      ),
    nextTextRevision:
      z.number()
        .int()
        .nonnegative(),
  }).strict()
    .superRefine(
      (plan, context) => {
        const upserts =
          new Set(
            plan.upsertChunkIds,
          );

        if (
          upserts.size !==
          plan.upsertChunkIds
            .length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["upsertChunkIds"],
            message:
              "Upsert chunk IDs must be unique.",
          });
        }

        const deletes =
          new Set(
            plan.deleteChunkIds,
          );

        if (
          deletes.size !==
          plan.deleteChunkIds
            .length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["deleteChunkIds"],
            message:
              "Delete chunk IDs must be unique.",
          });
        }

        for (
          const chunkId of
            upserts
        ) {
          if (
            deletes.has(chunkId)
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path:
                ["deleteChunkIds"],
              message:
                `Chunk "${chunkId}" cannot be both upserted and deleted.`,
            });
          }
        }
      },
    );

export const embeddingIndexStateSchema =
  z.object({
    workspace:
      z.string().min(1),
    rootId:
      z.string().min(1),
    profileId:
      z.string()
        .min(1)
        .regex(
          EMBEDDING_PATTERNS
            .PROFILE_ID,
        ),
    providerId:
      z.string().min(1),
    modelId:
      z.string().min(1),
    dimensions:
      z.number()
        .int()
        .positive(),
    normalized:
      z.boolean(),
    textRevision:
      z.number()
        .int()
        .nonnegative(),
    updatedAt:
      z.number()
        .int()
        .nonnegative(),
  }).strict();

export const embeddingIndexWriteBatchSchema =
  z.object({
    workspace:
      z.string().min(1),
    rootId:
      z.string().min(1),
    profileId:
      z.string()
        .min(1)
        .regex(
          EMBEDDING_PATTERNS
            .PROFILE_ID,
        ),
    profile:
      embeddingProfileSchema,
    expectedTextRevision:
      z.number()
        .int()
        .nonnegative(),
    nextTextRevision:
      z.number()
        .int()
        .nonnegative(),
    upserts:
      z.array(
        embeddingVectorRecordSchema,
      ),
    deleteChunkIds:
      z.array(
        z.string().min(1),
      ),
    updatedAt:
      z.number()
        .int()
        .nonnegative(),
  }).strict()
    .superRefine(
      (batch, context) => {
        if (
          batch.profileId !==
          batch.profile.id
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["profileId"],
            message:
              "Write profileId must match profile.id.",
          });
        }

        if (
          batch.nextTextRevision <=
          batch
            .expectedTextRevision
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["nextTextRevision"],
            message:
              "A write batch must advance the Text Index revision.",
          });
        }

        const upserts =
          new Set<string>();

        for (
          let index = 0;
          index <
          batch.upserts.length;
          index += 1
        ) {
          const record =
            batch.upserts[index];

          if (!record) {
            continue;
          }

          if (
            record.rootId !==
            batch.rootId
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "upserts",
                index,
                "rootId",
              ],
              message:
                "Vector record rootId must match the write batch.",
            });
          }

          if (
            record.profileId !==
            batch.profileId
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "upserts",
                index,
                "profileId",
              ],
              message:
                "Vector record profileId must match the write batch.",
            });
          }

          if (
            record.vector.length !==
            batch.profile
              .dimensions
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "upserts",
                index,
                "vector",
              ],
              message:
                "Vector dimensions must match the write profile.",
            });
          }

          if (
            upserts.has(
              record.chunkId,
            )
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "upserts",
                index,
                "chunkId",
              ],
              message:
                "Upsert chunk IDs must be unique.",
            });
          }

          upserts.add(
            record.chunkId,
          );
        }

        const deletes =
          new Set<string>();

        for (
          let index = 0;
          index <
          batch
            .deleteChunkIds
            .length;
          index += 1
        ) {
          const chunkId =
            batch
              .deleteChunkIds[
              index
            ];

          if (!chunkId) {
            continue;
          }

          if (
            deletes.has(chunkId)
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "deleteChunkIds",
                index,
              ],
              message:
                "Delete chunk IDs must be unique.",
            });
          }

          if (
            upserts.has(chunkId)
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "deleteChunkIds",
                index,
              ],
              message:
                "A chunk cannot be upserted and deleted in the same batch.",
            });
          }

          deletes.add(chunkId);
        }
      },
    );

export const embeddingIndexWriteResultSchema =
  z.object({
    action:
      z.literal("applied"),
    previousTextRevision:
      z.number()
        .int()
        .nonnegative(),
    textRevision:
      z.number()
        .int()
        .nonnegative(),
    vectorsUpserted:
      z.number()
        .int()
        .nonnegative(),
    vectorsDeleted:
      z.number()
        .int()
        .nonnegative(),
  }).strict()
    .refine(
      (result) =>
        result.textRevision >=
        result.previousTextRevision,
      {
        path: ["textRevision"],
        message:
          "Text revision cannot move backwards.",
      },
    );

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
