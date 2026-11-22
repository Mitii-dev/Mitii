import {
  z,
} from "zod";

import {
  EMBEDDING_PATTERNS,
} from "../constants";

import {
  embeddingProfileSchema,
  embeddingVectorRecordSchema,
} from "./vectorRecordSchemas";

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
