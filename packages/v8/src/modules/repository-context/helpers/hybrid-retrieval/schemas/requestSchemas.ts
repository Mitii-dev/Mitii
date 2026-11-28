import {
  z,
} from "zod";

import {
  HYBRID_RETRIEVAL_LIMITS,
} from "../constants";

import {
  canonicalRelativePathSchema,
  chunkKindSchema,
  repoMapReferenceSchema,
  repoGraphReferenceSchema,
  uniqueStringsSchema,
  rankingContextSchema,
} from "./primitiveSchemas";

export const hybridRetrievalInputSchema =
  z.object({
    workspace:
      z.string().min(1),
    query:
      z.string()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_QUERY_CHARACTERS,
        ),

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
    anchorFilePaths:
      z.array(
        canonicalRelativePathSchema,
      ).optional(),
    kinds:
      z.array(
        chunkKindSchema,
      ).optional(),

    rankingContext:
      rankingContextSchema
        .optional(),

    maximumResults:
      z.number()
        .int()
        .positive()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_RESULTS,
        )
        .optional(),
    maximumCandidatesPerSource:
      z.number()
        .int()
        .positive()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_CANDIDATES_PER_SOURCE,
        )
        .optional(),

    workspaceSnapshotId:
      z.string()
        .min(1)
        .optional(),
    codeIndexChangeToken:
      z.string()
        .min(1)
        .optional(),

    repoMap:
      repoMapReferenceSchema
        .optional(),
    repoGraph:
      repoGraphReferenceSchema
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

export const normalizedHybridRetrievalRequestSchema =
  z.object({
    workspace:
      z.string().min(1),
    query:
      z.string().min(1),

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
    anchorFilePaths:
      uniqueStringsSchema(
        canonicalRelativePathSchema,
      ),
    kinds:
      z.array(
        chunkKindSchema,
      )
        .max(
          HYBRID_RETRIEVAL_LIMITS
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

    rankingContext:
      rankingContextSchema
        .optional(),

    maximumResults:
      z.number()
        .int()
        .positive()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_RESULTS,
        ),
    maximumCandidatesPerSource:
      z.number()
        .int()
        .positive()
        .max(
          HYBRID_RETRIEVAL_LIMITS
            .MAXIMUM_CANDIDATES_PER_SOURCE,
        ),

    workspaceSnapshotId:
      z.string()
        .min(1)
        .optional(),
    codeIndexChangeToken:
      z.string()
        .min(1)
        .optional(),

    repoMap:
      repoMapReferenceSchema
        .optional(),
    repoGraph:
      repoGraphReferenceSchema
        .optional(),
  }).strict();
