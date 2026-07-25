import { z } from "zod";

import {
  SOURCE_ANALYSIS_SCHEMA_VERSION,
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

export const sourceAnalysisSymbolSchema = z
  .object({
    localId:
      z.string().min(1),
    name:
      z.string().min(1),
    kind:
      z.string().min(1),
    parentLocalId:
      z.string().min(1).optional(),
    exported:
      z.boolean().optional(),
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
      symbol.endLine <
        symbol.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message:
          "endLine cannot be smaller than startLine.",
      });
    }

    if (
      symbol.startColumn !==
        undefined &&
      symbol.endColumn !==
        undefined &&
      symbol.endLine ===
        symbol.startLine &&
      symbol.endColumn <
        symbol.startColumn
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endColumn"],
        message:
          "endColumn cannot be smaller than startColumn on the same line.",
      });
    }

    if (
      symbol.parentLocalId ===
      symbol.localId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentLocalId"],
        message:
          "A symbol cannot be its own parent.",
      });
    }
  });

export const sourceAnalysisImportSchema = z
  .object({
    specifier:
      z.string().min(1),
    kind: z.enum([
      "static",
      "dynamic",
      "require",
      "reexport",
      "unknown",
    ]),
    importedNames:
      uniqueStringArraySchema,
    line:
      z.number().int().positive(),
    column:
      z.number().int().positive().optional(),
  })
  .strict();

export const sourceAnalysisReferenceSchema = z
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

export const sourceAnalysisWarningSchema = z
  .object({
    code: z.enum([
      "language_unknown",
      "parser_not_found",
      "parser_failed",
      "parser_runtime_warning",
      "parser_returned_empty",
      "parser_result_invalid",
      "syntax_diagnostics",
      "symbols_truncated",
      "imports_truncated",
      "references_truncated",
      "duplicate_symbol_removed",
      "duplicate_import_removed",
      "duplicate_reference_removed",
      "invalid_parent_removed",
    ]),
    message:
      z.string().min(1),
    parserId:
      z.string().min(1).optional(),
    line:
      z.number().int().positive().optional(),
  })
  .strict();

export const sourceParserResultSchema = z
  .object({
    parserId:
      z.string().min(1),
    language:
      z.string().min(1),
    quality: z.enum([
      "precise",
      "structural",
      "heuristic",
      "none",
    ]),
    status: z.enum([
      "complete",
      "partial",
    ]),
    symbols:
      z.array(
        sourceAnalysisSymbolSchema,
      ),
    imports:
      z.array(
        sourceAnalysisImportSchema,
      ),
    references:
      z.array(
        sourceAnalysisReferenceSchema,
      ),
    warnings:
      z.array(
        sourceAnalysisWarningSchema,
      ),
  })
  .strict()
  .refine(
    (result) =>
      result.quality !== "none",
    {
      path: ["quality"],
      message:
        "A successful parser result requires a non-none quality.",
    },
  );

export const sourceAnalysisSchema = z
  .object({
    schemaVersion:
      z.literal(
        SOURCE_ANALYSIS_SCHEMA_VERSION,
      ),
    sourceId:
      z.string().min(1),
    rootId:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    language:
      z.string().min(1).optional(),
    languageSource: z.enum([
      "explicit",
      "basename",
      "extension",
      "unknown",
    ]),
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
      "failed",
    ]),
    symbols:
      z.array(
        sourceAnalysisSymbolSchema,
      ),
    imports:
      z.array(
        sourceAnalysisImportSchema,
      ),
    references:
      z.array(
        sourceAnalysisReferenceSchema,
      ),
    warnings:
      z.array(
        sourceAnalysisWarningSchema,
      ),
  })
  .strict()
  .superRefine((analysis, context) => {
    const successful =
      analysis.status ===
        "complete" ||
      analysis.status ===
        "partial";

    if (
      successful &&
      (!analysis.language ||
        !analysis.parserId ||
        analysis.quality === "none")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "Successful analysis requires language, parserId, and non-none quality.",
      });
    }

    if (
      !successful &&
      (analysis.parserId !== undefined ||
        analysis.quality !== "none" ||
        analysis.symbols.length > 0 ||
        analysis.imports.length > 0 ||
        analysis.references.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "Unsupported or failed analysis cannot expose authoritative facts.",
      });
    }

    if (
      analysis.languageSource ===
        "unknown" &&
      analysis.language !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["language"],
        message:
          "Unknown languageSource cannot include a language.",
      });
    }

    if (
      analysis.languageSource !==
        "unknown" &&
      analysis.language === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["language"],
        message:
          "Known languageSource requires a language.",
      });
    }

    const symbolIds =
      new Set<string>();

    for (
      const [
        index,
        symbol,
      ] of analysis.symbols.entries()
    ) {
      if (
        symbolIds.has(
          symbol.localId,
        )
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          path: [
            "symbols",
            index,
            "localId",
          ],
          message:
            `Duplicate local symbol ID "${symbol.localId}".`,
        });
      }

      symbolIds.add(
        symbol.localId,
      );
    }

    for (
      const [
        index,
        symbol,
      ] of analysis.symbols.entries()
    ) {
      if (
        symbol.parentLocalId &&
        !symbolIds.has(
          symbol.parentLocalId,
        )
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          path: [
            "symbols",
            index,
            "parentLocalId",
          ],
          message:
            "parentLocalId must reference an included symbol.",
        });
      }
    }
  });
