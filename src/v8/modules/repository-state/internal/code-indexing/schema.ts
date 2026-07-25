import { z } from "zod";

import {
  CODE_INDEXING_PATTERNS,
  CODE_INDEXING_SCHEMA_VERSION,
} from "./constants";

import {
  sourceAnalysisSchema,
} from "../source-analysis/schema";

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

const uniqueStringsSchema = z
  .array(z.string().min(1))
  .refine(
    (values) =>
      new Set(values).size ===
      values.length,
    {
      message: "Values must be unique.",
    },
  );

export const codeIndexFileLocatorSchema = z
  .object({
    workspace: z.string().min(1),
    rootId: z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
  })
  .strict();

export const codeIndexFileVersionSchema =
  codeIndexFileLocatorSchema.extend({
    providerPath:
      z.string().min(1).optional(),
    language:
      z.string().min(1).optional(),
    contentHash:
      z.string().regex(
        CODE_INDEXING_PATTERNS.CONTENT_HASH,
      ),
    size:
      z.number().int().nonnegative(),
    modifiedAt:
      z.string().datetime().optional(),
    analysisVersion:
      z.string().min(1),
  });

const documentSymbolSchema = z
  .object({
    localId: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().min(1),
    parentLocalId:
      z.string().min(1).optional(),
    exported: z.boolean().optional(),
    signature:
      z.string().min(1).optional(),
    startLine:
      z.number().int().positive(),
    endLine:
      z.number().int().positive().optional(),
    startColumn:
      z.number().int().positive().optional(),
    endColumn:
      z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((symbol, context) => {
    if (
      symbol.endLine !== undefined &&
      symbol.endLine < symbol.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message:
          "endLine cannot be smaller than startLine.",
      });
    }
  });

const documentImportSchema = z
  .object({
    specifier: z.string().min(1),
    kind: z.enum([
      "static",
      "dynamic",
      "require",
      "reexport",
      "unknown",
    ]),
    importedNames:
      uniqueStringsSchema,
    line:
      z.number().int().positive(),
    column:
      z.number().int().positive().optional(),
    resolution: z.enum([
      "resolved",
      "unresolved",
    ]),
    targetRelativePath:
      canonicalRelativePathSchema.optional(),
    candidateRelativePath:
      canonicalRelativePathSchema.optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (
      item.resolution === "resolved" &&
      !item.targetRelativePath
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetRelativePath"],
        message:
          "Resolved imports require targetRelativePath.",
      });
    }

    if (
      item.resolution === "unresolved" &&
      item.targetRelativePath
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetRelativePath"],
        message:
          "Unresolved imports cannot have an authoritative target.",
      });
    }
  });

const documentReferenceSchema = z
  .object({
    symbolName:
      z.string().min(1),
    kind: z.enum([
      "call",
      "construct",
      "type",
      "read",
      "write",
      "unknown",
    ]),
    line:
      z.number().int().positive(),
    column:
      z.number().int().positive().optional(),
  })
  .strict();

export const codeIndexDocumentSchema = z
  .object({
    schemaVersion:
      z.literal(
        CODE_INDEXING_SCHEMA_VERSION,
      ),
    file:
      codeIndexFileVersionSchema,
    sourceAnalysisSchemaVersion:
      z.literal(1),
    sourceId:
      z.string().min(1),
    parserId:
      z.string().min(1).optional(),
    quality: z.enum([
      "precise",
      "structural",
      "heuristic",
      "none",
    ]),
    status: z.enum([
      "complete",
      "partial",
      "unsupported",
    ]),
    symbols:
      z.array(documentSymbolSchema),
    imports:
      z.array(documentImportSchema),
    references:
      z.array(
        documentReferenceSchema,
      ),
    indexedAt:
      z.number().int().nonnegative(),
    workspaceSnapshotId:
      z.string().min(1),
  })
  .strict()
  .superRefine((document, context) => {
    const terminal =
      document.status === "unsupported";

    if (
      terminal &&
      (document.parserId ||
        document.quality !== "none" ||
        document.symbols.length > 0 ||
        document.imports.length > 0 ||
        document.references.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "Unsupported documents cannot expose parsed facts.",
      });
    }

    if (
      !terminal &&
      (!document.parserId ||
        document.quality === "none")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "Parsed documents require parserId and non-none quality.",
      });
    }

    const localIds = new Set<string>();

    for (
      const [
        index,
        symbol,
      ] of document.symbols.entries()
    ) {
      if (localIds.has(symbol.localId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "symbols",
            index,
            "localId",
          ],
          message:
            `Duplicate symbol localId "${symbol.localId}".`,
        });
      }

      localIds.add(symbol.localId);
    }

    for (
      const [
        index,
        symbol,
      ] of document.symbols.entries()
    ) {
      if (
        symbol.parentLocalId &&
        !localIds.has(
          symbol.parentLocalId,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "symbols",
            index,
            "parentLocalId",
          ],
          message:
            "parentLocalId must reference another included symbol.",
        });
      }
    }
  });

export const codeIndexUpdatePlanSchema = z
  .object({
    action: z.enum([
      "insert",
      "replace",
      "refresh_metadata",
      "skip",
      "remove",
    ]),
    reason: z.enum([
      "file_not_indexed",
      "content_changed",
      "analysis_version_changed",
      "analysis_status_changed",
      "metadata_changed",
      "unchanged",
      "file_removed",
    ]),
  })
  .strict();

const codeIndexWriteResultSchema = z
  .object({
    action: z.enum([
      "inserted",
      "replaced",
      "metadata_refreshed",
      "removed",
      "not_found",
    ]),
    file:
      codeIndexFileLocatorSchema,
    revision:
      z.number()
        .int()
        .nonnegative(),
    counts:
      z.object({
        symbols:
          z.number()
            .int()
            .nonnegative(),
        imports:
          z.number()
            .int()
            .nonnegative(),
        references:
          z.number()
            .int()
            .nonnegative(),
      }).strict(),
  }).strict();

export const codeIndexUpdateResultSchema = z
  .object({
    status: z.enum([
      "indexed",
      "metadata_refreshed",
      "unchanged",
      "removed",
      "not_found",
    ]),
    plan:
      codeIndexUpdatePlanSchema,
    write:
      codeIndexWriteResultSchema
        .optional(),
  }).strict();

export const codeIndexCoordinatorResultSchema = z
  .object({
    status: z.enum([
      "indexed",
      "metadata_refreshed",
      "unchanged",
      "unsupported",
      "analysis_failed",
    ]),
    analysis:
      sourceAnalysisSchema,
    update:
      codeIndexUpdateResultSchema
        .optional(),
  }).strict()
    .superRefine(
      (
        result,
        context,
      ) => {
        if (
          result.status ===
            "analysis_failed" &&
          result.analysis.status !==
            "failed"
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "analysis",
              "status",
            ],
            message:
              "analysis_failed requires a failed SourceAnalysis.",
          });
        }

        if (
          result.status !==
            "analysis_failed" &&
          !result.update
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "update",
            ],
            message:
              "Indexed coordinator results require an update result.",
          });
        }

        if (
          result.status ===
            "unsupported" &&
          result.analysis.status !==
            "unsupported"
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "analysis",
              "status",
            ],
            message:
              "unsupported requires an unsupported SourceAnalysis.",
          });
        }
      },
    );
