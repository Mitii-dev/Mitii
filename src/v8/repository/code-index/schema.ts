import { z } from "zod";

import { CODE_INDEX_PATTERNS } from "./constants";

export const codeIndexRelativePathSchema = z
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

export const codeIndexFileSchema = z
  .object({
    id: z.string().min(1),
    rootId: z.string().min(1),

    relativePath: codeIndexRelativePathSchema,

    language: z.string().min(1).optional(),

    size: z.number().nonnegative().optional(),

    modifiedAt: z.string().datetime().optional(),

    contentHash: z.string().regex(CODE_INDEX_PATTERNS.CONTENT_HASH).optional(),
  })
  .strict();

export const codeIndexSymbolSchema = z
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

export const codeIndexImportSchema = z
  .object({
    fromFileId: z.string().min(1),

    toFileId: z.string().min(1).optional(),

    specifier: z.string().min(1).optional(),

    resolvedRelativePath: codeIndexRelativePathSchema.optional(),

    importedNames: z
      .array(z.string().min(1))
      .refine((values) => new Set(values).size === values.length, {
        message: "Imported names must be unique.",
      }),
  })
  .strict();

export const codeIndexReferenceSchema = z
  .object({
    fromFileId: z.string().min(1),

    symbolName: z.string().min(1),

    toFileId: z.string().min(1).optional(),

    toSymbolId: z.string().min(1).optional(),
  })
  .strict();

export const codeIndexFileQueryResultSchema = z
  .object({
    files: z.array(codeIndexFileSchema),

    totalAvailable: z.number().int().nonnegative(),

    truncated: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.totalAvailable < result.files.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["totalAvailable"],

        message: "totalAvailable cannot be smaller than files.length.",
      });
    }

    if (result.truncated !== result.totalAvailable > result.files.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["truncated"],

        message: "truncated must indicate whether matching files were omitted.",
      });
    }

    const fileIds = new Set<string>();

    for (let index = 0; index < result.files.length; index += 1) {
      const file = result.files[index];

      if (fileIds.has(file.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ["files", index, "id"],

          message: `Duplicate Code Index file ID "${file.id}".`,
        });
      }

      fileIds.add(file.id);
    }
  });
