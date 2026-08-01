import {
  z,
} from "zod";

import {
  chunkSchema,
} from "../chunking/schema";

import {
  TEXT_INDEX_PATTERNS,
  TEXT_INDEX_SCHEMA_VERSION,
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

const contentHashSchema =
  z.string().regex(
    TEXT_INDEX_PATTERNS
      .CONTENT_HASH,
  );

export const textIndexDocumentLocatorSchema =
  z.object({
    workspace:
      z.string().min(1),
    rootId:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
  }).strict();

export const textIndexDocumentSchema =
  z.object({
    schemaVersion:
      z.literal(
        TEXT_INDEX_SCHEMA_VERSION,
      ),

    workspace:
      z.string().min(1),
    rootId:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    sourceId:
      z.string().min(1),

    sourceContentHash:
      contentHashSchema,
    language:
      z.string()
        .min(1)
        .optional(),

    chunkingSchemaVersion:
      z.literal(1),
    pipelineVersion:
      z.string().min(1),
    chunkingStatus: z.enum([
      "complete",
      "partial",
      "empty",
    ]),
    strategyId:
      z.string()
        .min(1)
        .optional(),

    chunks:
      z.array(chunkSchema),

    workspaceSnapshotId:
      z.string().min(1),
    indexedAt:
      z.number()
        .int()
        .nonnegative(),
  })
    .strict()
    .superRefine(
      (document, context) => {
        if (
          document.chunkingStatus ===
            "empty" &&
          document.chunks.length > 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: ["chunks"],
            message:
              "An empty document cannot contain chunks.",
          });
        }

        for (
          let index = 0;
          index <
          document.chunks.length;
          index += 1
        ) {
          const chunk =
            document.chunks[index];

          if (!chunk) {
            continue;
          }

          if (
            chunk.rootId !==
              document.rootId ||
            chunk.relativePath !==
              document.relativePath ||
            chunk.sourceId !==
              document.sourceId ||
            chunk
              .sourceContentHash !==
              document
                .sourceContentHash
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "chunks",
                index,
              ],
              message:
                "Chunk identity must match its Text Index document.",
            });
          }
        }
      },
    );

export const textSearchMatchSchema =
  z.object({
    chunkId:
      z.string().min(1),
    rootId:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
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
    title:
      z.string()
        .min(1)
        .optional(),
    symbolLocalId:
      z.string()
        .min(1)
        .optional(),
    snippet:
      z.string().min(1),
    score:
      z.number()
        .min(0)
        .max(1),
    rawRank:
      z.number().finite(),
    startLine:
      z.number()
        .int()
        .positive(),
    endLine:
      z.number()
        .int()
        .positive(),
    contentHash:
      contentHashSchema,
    tokenEstimate:
      z.number()
        .int()
        .positive(),
  }).strict();

export const textSearchWarningSchema =
  z.object({
    code: z.enum([
      "query_truncated",
      "terms_truncated",
      "terms_removed",
      "duplicate_filter_removed",
    ]),
    message:
      z.string().min(1),
  }).strict();

export const textSearchResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        TEXT_INDEX_SCHEMA_VERSION,
      ),
    query:
      z.string(),
    normalizedTerms:
      z.array(
        z.string().min(1),
      ),
    status: z.enum([
      "complete",
      "empty",
      "cancelled",
    ]),
    matches:
      z.array(
        textSearchMatchSchema,
      ),
    truncated:
      z.boolean(),
    warnings:
      z.array(
        textSearchWarningSchema,
      ),
  })
    .strict()
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
              "Only complete searches can contain matches.",
          });
        }

        const ids =
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
            ids.has(
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
                "Search matches must have unique chunk IDs.",
            });
          }

          ids.add(
            match.chunkId,
          );
        }
      },
    );

export const textIndexWriteResultSchema =
  z.object({
    action: z.enum([
      "inserted",
      "replaced",
      "metadata_refreshed",
      "removed",
      "not_found",
    ]),
    document:
      textIndexDocumentLocatorSchema,
    revision:
      z.number()
        .int()
        .nonnegative(),
    chunksWritten:
      z.number()
        .int()
        .nonnegative(),
    chunksRemoved:
      z.number()
        .int()
        .nonnegative(),
  }).strict();

export const textIndexSearchPageSchema =
  z.object({
    matches:
      z.array(
        textSearchMatchSchema,
      ),
    truncated:
      z.boolean(),
  }).strict();

export const textIndexChunkQueryResultSchema =
  z.object({
    chunks:
      z.array(chunkSchema),
    missingChunkIds:
      z.array(
        z.string().min(1),
      ),
    truncated:
      z.boolean(),
  }).strict();

export const textIndexChangeSchema =
  z.object({
    revision:
      z.number()
        .int()
        .positive(),
    kind: z.enum([
      "upsert",
      "delete",
    ]),
    chunkId:
      z.string().min(1),
    rootId:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    changedAt:
      z.number()
        .int()
        .nonnegative(),
  }).strict();

export const textIndexChangeQueryResultSchema =
  z.object({
    changes:
      z.array(
        textIndexChangeSchema,
      ),
    latestRevision:
      z.number()
        .int()
        .nonnegative(),
    truncated:
      z.boolean(),
  })
    .strict()
    .superRefine(
      (result, context) => {
        if (
          result.changes.some(
            (change) =>
              change.revision >
              result.latestRevision,
          )
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "latestRevision",
            ],
            message:
              "latestRevision cannot be smaller than a returned change revision.",
          });
        }
      },
    );

export const textIndexUpdateResultSchema =
  z.object({
    status: z.enum([
      "indexed",
      "metadata_refreshed",
      "unchanged",
      "removed",
      "not_found",
    ]),
    plan: z.object({
      action: z.enum([
        "insert",
        "replace",
        "refresh_metadata",
        "skip",
        "remove",
      ]),
      reason: z.enum([
        "document_not_indexed",
        "source_changed",
        "pipeline_changed",
        "chunking_status_changed",
        "chunk_count_changed",
        "snapshot_changed",
        "unchanged",
        "document_removed",
      ]),
    }).strict(),
    write:
      textIndexWriteResultSchema
        .optional(),
  }).strict();

export const textIndexCoordinatorResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        TEXT_INDEX_SCHEMA_VERSION,
      ),
    status: z.enum([
      "indexed",
      "metadata_refreshed",
      "unchanged",
      "empty_indexed",
      "cancelled",
      "not_indexable",
    ]),
    chunkingStatus: z.enum([
      "complete",
      "partial",
      "empty",
      "cancelled",
      "rejected",
      "failed",
    ]),
    update:
      textIndexUpdateResultSchema
        .optional(),
  }).strict();
