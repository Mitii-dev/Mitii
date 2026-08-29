import { z } from "zod";

import {
  CODE_INDEX_PATTERNS,
} from "./constants";

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
      new Set(values).size === values.length,
    {
      message: "Values must be unique.",
    },
  );

export const codeIndexFileSchema = z
  .object({
    id: z.string().min(1),
    rootId: z.string().min(1),
    relativePath:
      codeIndexRelativePathSchema,
    language:
      z.string().min(1).optional(),
    size:
      z.number().nonnegative().optional(),
    modifiedAt:
      z.string().datetime().optional(),
    contentHash:
      z
        .string()
        .regex(
          CODE_INDEX_PATTERNS.CONTENT_HASH,
        )
        .optional(),
  })
  .strict();

export const codeIndexSymbolSchema = z
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
  .superRefine((symbol, context) => {
    if (
      symbol.startLine !== undefined &&
      symbol.endLine !== undefined &&
      symbol.endLine < symbol.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message:
          "endLine must be greater than or equal to startLine.",
      });
    }
  });

export const codeIndexSymbolQuerySchema = z
  .object({
    fileIds: uniqueStringArraySchema,
    maximumSymbolsPerFile:
      z.number().int().positive(),
    kinds:
      uniqueStringArraySchema.optional(),
    namePrefix:
      z.string().trim().min(1).optional(),
  })
  .strict();

export const codeIndexResolvedImportSchema = z
  .object({
    resolution: z.literal("resolved"),
    fromFileId: z.string().min(1),
    toFileId: z.string().min(1),
    resolvedRelativePath:
      codeIndexRelativePathSchema,
    specifier: z.string().min(1),
    line:
      z.number().int().positive().optional(),
    importedNames:
      uniqueStringArraySchema,
  })
  .strict();

export const codeIndexUnresolvedImportSchema = z
  .object({
    resolution: z.literal("unresolved"),
    fromFileId: z.string().min(1),
    specifier: z.string().min(1),
    line:
      z.number().int().positive().optional(),
    candidateRelativePath:
      codeIndexRelativePathSchema.optional(),
    importedNames:
      uniqueStringArraySchema,
  })
  .strict();

export const codeIndexImportSchema =
  z.discriminatedUnion("resolution", [
    codeIndexResolvedImportSchema,
    codeIndexUnresolvedImportSchema,
  ]);

export const codeIndexReferenceSchema = z
  .object({
    fromFileId: z.string().min(1),
    symbolName: z.string().min(1),
    kind: z.enum([
      "call",
      "construct",
      "type",
      "read",
      "write",
      "unknown",
    ]),
    line:
      z.number().int().positive().optional(),
    resolution: z.enum([
      "resolved",
      "ambiguous",
      "unresolved",
    ]),
    toFileId:
      z.string().min(1).optional(),
    toSymbolId:
      z.string().min(1).optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    const hasTarget =
      Boolean(reference.toFileId) ||
      Boolean(reference.toSymbolId);

    if (
      reference.resolution ===
        "resolved" &&
      !hasTarget
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolution"],
        message:
          "Resolved references require a target.",
      });
    }

    if (
      reference.resolution !==
        "resolved" &&
      hasTarget
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolution"],
        message:
          "Ambiguous and unresolved references cannot expose an authoritative target.",
      });
    }
  });

export const codeIndexFileQueryResultSchema = z
  .object({
    files:
      z.array(codeIndexFileSchema),
    totalAvailable:
      z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.totalAvailable <
      result.files.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalAvailable"],
        message:
          "totalAvailable cannot be smaller than files.length.",
      });
    }

    const expectedTruncated =
      result.totalAvailable >
      result.files.length;

    if (
      result.truncated !==
      expectedTruncated
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truncated"],
        message:
          "truncated must indicate whether matching files were omitted.",
      });
    }

    const fileIds = new Set<string>();

    for (
      const [
        index,
        file,
      ] of result.files.entries()
    ) {

      if (fileIds.has(file.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "id"],
          message:
            `Duplicate Code Index file ID "${file.id}".`,
        });
      }

      fileIds.add(file.id);
    }
  });
