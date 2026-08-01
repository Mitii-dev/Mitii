import { z } from "zod";

import {
  REPO_MAP_SCHEMA_VERSION,
} from "./constants";

const canonicalRelativePathSchema = z
  .string()
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

const uniqueStringArraySchema = z
  .array(z.string().min(1))
  .refine(
    (values) =>
      new Set(values).size ===
      values.length,
    {
      message:
        "Values must be unique.",
    },
  );

export const repoMapFileSchema = z
  .object({
    id: z.string().min(1),
    rootId: z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    projectId:
      z.string().min(1).optional(),
    language:
      z.string().min(1).optional(),
    size:
      z.number().nonnegative().optional(),
    modifiedAt:
      z.string().datetime().optional(),
    contentHash:
      z.string().min(1).optional(),
  })
  .strict();

export const repoMapSymbolSchema = z
  .object({
    id: z.string().min(1),
    fileId: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().min(1),
    parentSymbolId:
      z.string().min(1).optional(),
    exported: z.boolean().optional(),
    signature:
      z.string().min(1).optional(),
    startLine:
      z.number().int().positive().optional(),
    endLine:
      z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (symbol) =>
      symbol.startLine === undefined ||
      symbol.endLine === undefined ||
      symbol.endLine >=
        symbol.startLine,
    {
      path: ["endLine"],
      message:
        "endLine must be greater than or equal to startLine.",
    },
  );

export const repoMapScoreReasonSchema = z
  .object({
    type: z.enum([
      "current_file",
      "open_file",
      "git_diff",
      "diagnostic",
      "recent_edit",
      "query_path",
      "query_symbol",
      "inbound_import",
      "outbound_import",
      "inbound_reference",
      "outbound_reference",
      "page_rank",
      "entry_point",
    ]),
    score: z.number().finite(),
    evidence:
      z.string().min(1),
  })
  .strict();

export const repoMapEntrySchema = z
  .object({
    file: repoMapFileSchema,
    symbols:
      z.array(repoMapSymbolSchema),
    score:
      z.number().finite(),
    pageRank:
      z.number().nonnegative(),
    inboundImportCount:
      z.number().int().nonnegative(),
    outboundImportCount:
      z.number().int().nonnegative(),
    inboundReferenceCount:
      z.number().int().nonnegative(),
    outboundReferenceCount:
      z.number().int().nonnegative(),
    reasons:
      z.array(
        repoMapScoreReasonSchema,
      ),
  })
  .strict()
  .superRefine((entry, context) => {
    const symbolIds =
      new Set<string>();

    for (
      const [
        index,
        symbol,
      ] of entry.symbols.entries()
    ) {

      if (
        symbol.fileId !==
        entry.file.id
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          path: [
            "symbols",
            index,
            "fileId",
          ],
          message:
            "Symbol fileId must reference the entry file.",
        });
      }

      if (
        symbolIds.has(symbol.id)
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          path: [
            "symbols",
            index,
            "id",
          ],
          message:
            `Duplicate Repo Map symbol ID "${symbol.id}".`,
        });
      }

      symbolIds.add(symbol.id);
    }
  });

export const repoMapStatisticsSchema = z
  .object({
    availableFiles:
      z.number().int().nonnegative(),
    rankedFiles:
      z.number().int().nonnegative(),
    includedFiles:
      z.number().int().nonnegative(),
    includedSymbols:
      z.number().int().nonnegative(),
    estimatedTokens:
      z.number().int().nonnegative(),
    durationMs:
      z.number().nonnegative(),
  })
  .strict();

export const repoMapSchema = z
  .object({
    schemaVersion:
      z.literal(
        REPO_MAP_SCHEMA_VERSION,
      ),
    workspaceSnapshotId:
      z.string().min(1),
    codeIndexChangeToken:
      z.string().min(1),
    entries:
      z.array(repoMapEntrySchema),
    statistics:
      repoMapStatisticsSchema,
    status:
      z.enum([
        "complete",
        "partial",
      ]),
    generatedAt:
      z.string().datetime({
        offset: false,
      }),
  })
  .strict()
  .superRefine((repoMap, context) => {
    const fileIds =
      new Set<string>();

    for (
      const [
        index,
        entry,
      ] of repoMap.entries.entries()
    ) {
      const fileId =
        entry.file.id;

      if (fileIds.has(fileId)) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          path: [
            "entries",
            index,
            "file",
            "id",
          ],
          message:
            `Duplicate Repo Map file ID "${fileId}".`,
        });
      }

      fileIds.add(fileId);
    }

    const includedSymbols =
      repoMap.entries.reduce(
        (total, entry) =>
          total +
          entry.symbols.length,
        0,
      );

    if (
      repoMap.statistics
        .includedFiles !==
      repoMap.entries.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "statistics",
          "includedFiles",
        ],
        message:
          "includedFiles must equal entries.length.",
      });
    }

    if (
      repoMap.statistics
        .includedSymbols !==
      includedSymbols
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "statistics",
          "includedSymbols",
        ],
        message:
          "includedSymbols must equal the number of included symbols.",
      });
    }

    if (
      repoMap.statistics
        .rankedFiles <
      repoMap.statistics
        .includedFiles
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "statistics",
          "rankedFiles",
        ],
        message:
          "rankedFiles cannot be smaller than includedFiles.",
      });
    }

    if (
      repoMap.statistics
        .availableFiles <
      repoMap.statistics
        .rankedFiles
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "statistics",
          "availableFiles",
        ],
        message:
          "availableFiles cannot be smaller than rankedFiles.",
      });
    }
  });

export const repoMapFileSelectionSchema =
  z.union([
    z.string().min(1),
    z
      .object({
        rootId:
          z.string().min(1).optional(),
        relativePath:
          canonicalRelativePathSchema,
      })
      .strict(),
  ]);

export const repoMapRankingContextSchema =
  z
    .object({
      query:
        z.string().min(1).optional(),
      rootIds:
        uniqueStringArraySchema.optional(),
      folderPrefix:
        z.string().min(1).optional(),
      currentFile:
        repoMapFileSelectionSchema.optional(),
      openFiles:
        z.array(
          repoMapFileSelectionSchema,
        ).optional(),
      gitDiffFiles:
        z.array(
          repoMapFileSelectionSchema,
        ).optional(),
      diagnosticFiles:
        z.array(
          repoMapFileSelectionSchema,
        ).optional(),
      recentEditFiles:
        z.array(
          repoMapFileSelectionSchema,
        ).optional(),
    })
    .strict();
