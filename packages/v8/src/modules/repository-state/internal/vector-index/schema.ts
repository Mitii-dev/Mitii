import {
  z,
} from "zod";

import {
  embeddingProfileSchema,
} from "../embedding/schema";

import {
  VECTOR_INDEX_LIMITS,
  VECTOR_INDEX_PATTERNS,
  VECTOR_INDEX_SCHEMA_VERSION,
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

const uniqueStringsSchema = (
  valueSchema: z.ZodType<string>,
) =>
  z.array(valueSchema)
    .max(
      VECTOR_INDEX_LIMITS
        .MAXIMUM_FILTER_VALUES,
    )
    .refine(
      (values) =>
        new Set(values).size ===
        values.length,
      {
        message:
          "Filter values must be unique.",
      },
    );

export const vectorSearchInputSchema =
  z.object({
    workspace:
      z.string().min(1),
    profile:
      embeddingProfileSchema,
    queryVector:
      z.array(
        z.number().finite(),
      ).min(1),

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
          VECTOR_INDEX_LIMITS
            .MAXIMUM_RESULTS,
        )
        .optional(),
    minimumScore:
      z.number()
        .min(0)
        .max(1)
        .optional(),
    candidateMultiplier:
      z.number()
        .int()
        .positive()
        .max(
          VECTOR_INDEX_LIMITS
            .MAXIMUM_CANDIDATE_MULTIPLIER,
        )
        .optional(),

    nprobes:
      z.number()
        .int()
        .positive()
        .max(
          VECTOR_INDEX_LIMITS
            .MAXIMUM_NPROBES,
        )
        .optional(),
    refineFactor:
      z.number()
        .int()
        .positive()
        .max(
          VECTOR_INDEX_LIMITS
            .MAXIMUM_REFINE_FACTOR,
        )
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

export const normalizedVectorSearchRequestSchema =
  z.object({
    workspace:
      z.string().min(1),
    profile:
      embeddingProfileSchema,
    queryVector:
      z.array(
        z.number().finite(),
      ).min(1),

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
          VECTOR_INDEX_LIMITS
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
          VECTOR_INDEX_LIMITS
            .MAXIMUM_RESULTS,
        ),
    minimumScore:
      z.number()
        .min(0)
        .max(1),
    candidateLimit:
      z.number()
        .int()
        .positive(),

    nprobes:
      z.number()
        .int()
        .positive()
        .max(
          VECTOR_INDEX_LIMITS
            .MAXIMUM_NPROBES,
        ),
    refineFactor:
      z.number()
        .int()
        .positive()
        .max(
          VECTOR_INDEX_LIMITS
            .MAXIMUM_REFINE_FACTOR,
        ),
  }).strict()
    .superRefine(
      (request, context) => {
        if (
          request.queryVector.length !==
          request.profile.dimensions
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["queryVector"],
            message:
              "Query vector dimensions must match the embedding profile.",
          });
        }

        if (
          request.candidateLimit <=
          request.maximumResults
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["candidateLimit"],
            message:
              "candidateLimit must exceed maximumResults.",
          });
        }
      },
    );

export const vectorSearchMatchSchema =
  z.object({
    chunkId:
      z.string().min(1),
    rootId:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    kind:
      chunkKindSchema,
    ordinal:
      z.number()
        .int()
        .nonnegative(),
    contentHash:
      z.string().regex(
        VECTOR_INDEX_PATTERNS
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
      z.string().min(1),
    score:
      z.number()
        .min(0)
        .max(1),
    distance:
      z.number()
        .min(0)
        .max(2),
  }).strict()
    .refine(
      (match) =>
        match.endLine >=
        match.startLine,
      {
        path: ["endLine"],
        message:
          "endLine must be greater than or equal to startLine.",
      },
    );

export const vectorIndexSearchPageSchema =
  z.object({
    matches:
      z.array(
        vectorSearchMatchSchema,
      ),
    truncated:
      z.boolean(),
  }).strict();

export const vectorSearchResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        VECTOR_INDEX_SCHEMA_VERSION,
      ),
    status: z.enum([
      "complete",
      "empty",
      "cancelled",
    ]),
    profile:
      embeddingProfileSchema,
    matches:
      z.array(
        vectorSearchMatchSchema,
      ),
    truncated:
      z.boolean(),
  }).strict()
    .superRefine(
      (result, context) => {
        if (
          result.status !==
            "complete" &&
          result.matches.length > 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["matches"],
            message:
              "Only a complete vector search can contain matches.",
          });
        }

        const chunkIds =
          new Set<string>();

        for (
          let index = 0;
          index <
          result.matches.length;
          index += 1
        ) {
          const match =
            result.matches[index];

          if (!match) {
            continue;
          }

          if (
            match.profileId !==
            result.profile.id
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "matches",
                index,
                "profileId",
              ],
              message:
                "Search match profileId must match the result profile.",
            });
          }

          if (
            chunkIds.has(
              match.chunkId,
            )
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "matches",
                index,
                "chunkId",
              ],
              message:
                "Vector search matches must have unique chunk IDs.",
            });
          }

          chunkIds.add(
            match.chunkId,
          );
        }
      },
    );
