import {
  z,
} from "zod";

import {
  EMBEDDING_LIMITS,
  EMBEDDING_PATTERNS,
} from "../constants";

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
