import { z } from "zod";

import {
  REPO_MAP_PATTERNS,
  REPO_MAP_SCHEMA_VERSION,
  REPO_MAP_SCORE_REASON_TYPES,
  REPO_MAP_STATUSES,
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
        .some((segment) => !segment || segment === "." || segment === ".."),
    {
      message: "Expected a canonical workspace-relative path.",
    },
  );

const repoMapFileSchema = z
  .object({
    id: z.string().min(1),
    rootId: z.string().min(1),

    relativePath: canonicalRelativePathSchema,

    projectId: z.string().min(1).optional(),

    language: z.string().min(1).optional(),

    size: z.number().nonnegative().optional(),

    modifiedAt: z.string().datetime().optional(),

    contentHash: z.string().regex(REPO_MAP_PATTERNS.CONTENT_HASH).optional(),
  })
  .strict();

const repoMapSymbolSchema = z
  .object({
    id: z.string().min(1),
    fileId: z.string().min(1),

    name: z.string().min(1),
    kind: z.string().min(1),

    exported: z.boolean().optional(),

    signature: z.string().min(1).optional(),

    startLine: z.number().int().positive().optional(),

    endLine: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (symbol) =>
      symbol.startLine === undefined ||
      symbol.endLine === undefined ||
      symbol.endLine >= symbol.startLine,
    {
      message: "endLine must be greater than or equal to startLine.",
    },
  );

const scoreReasonSchema = z
  .object({
    type: z.enum(REPO_MAP_SCORE_REASON_TYPES),

    score: z.number(),

    evidence: z.string().min(1),
  })
  .strict();

const repoMapEntrySchema = z
  .object({
    file: repoMapFileSchema,

    symbols: z.array(repoMapSymbolSchema),

    score: z.number(),

    pageRank: z.number().nonnegative(),

    inboundImportCount: z.number().int().nonnegative(),

    outboundImportCount: z.number().int().nonnegative(),

    referenceCount: z.number().int().nonnegative(),

    reasons: z.array(scoreReasonSchema),
  })
  .strict()
  .superRefine((entry, context) => {
    const symbolIds = new Set<string>();

    for (let index = 0; index < entry.symbols.length; index += 1) {
      const symbol = entry.symbols[index];

      if (symbol.fileId !== entry.file.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ["symbols", index, "fileId"],

          message: "Symbol fileId must match its Repo Map file ID.",
        });
      }

      if (symbolIds.has(symbol.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ["symbols", index, "id"],

          message: `Duplicate symbol ID "${symbol.id}".`,
        });
      }

      symbolIds.add(symbol.id);
    }
  });

export const repoMapSchema = z
  .object({
    schemaVersion: z.literal(REPO_MAP_SCHEMA_VERSION),

    workspaceSnapshotId: z.string().regex(REPO_MAP_PATTERNS.SNAPSHOT_ID),

    entries: z.array(repoMapEntrySchema),

    statistics: z
      .object({
        availableFiles: z.number().int().nonnegative(),

        rankedFiles: z.number().int().nonnegative(),

        includedFiles: z.number().int().nonnegative(),

        includedSymbols: z.number().int().nonnegative(),

        estimatedTokens: z.number().int().nonnegative(),

        durationMs: z.number().nonnegative(),
      })
      .strict(),

    status: z.enum(REPO_MAP_STATUSES),

    generatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((repoMap, context) => {
    if (repoMap.statistics.includedFiles !== repoMap.entries.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["statistics", "includedFiles"],

        message: "includedFiles must equal entries.length.",
      });
    }

    const symbolCount = repoMap.entries.reduce(
      (total, entry) => total + entry.symbols.length,
      0,
    );

    if (repoMap.statistics.includedSymbols !== symbolCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["statistics", "includedSymbols"],

        message: "includedSymbols does not match the Repo Map entries.",
      });
    }

    const fileIds = new Set<string>();

    for (let index = 0; index < repoMap.entries.length; index += 1) {
      const fileId = repoMap.entries[index].file.id;

      if (fileIds.has(fileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ["entries", index, "file", "id"],

          message: `Duplicate Repo Map file ID "${fileId}".`,
        });
      }

      fileIds.add(fileId);
    }

    if (repoMap.statistics.rankedFiles < repoMap.statistics.includedFiles) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["statistics", "rankedFiles"],

        message: "rankedFiles cannot be smaller than includedFiles.",
      });
    }

    if (repoMap.statistics.availableFiles < repoMap.statistics.rankedFiles) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["statistics", "availableFiles"],

        message: "availableFiles cannot be smaller than rankedFiles.",
      });
    }
  });
