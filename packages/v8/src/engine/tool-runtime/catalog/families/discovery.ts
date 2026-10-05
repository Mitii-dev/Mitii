import { z } from "zod";

export const listDirectoryInputSchema = z
  .object({
    path: z.string().min(1).default("."),
  })
  .strict();

export const listDirectoryOutputSchema = z
  .object({
    path: z.string(),
    entries: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(["file", "directory", "symlink", "other"]),
      }),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const directoryTreeInputSchema = z
  .object({
    path: z.string().min(1).default("."),
    maxDepth: z.number().int().positive().max(20).optional(),
    maxEntries: z.number().int().positive().max(5_000).optional(),
    excludeNames: z.array(z.string().min(1).max(256)).max(50).optional(),
  })
  .strict();

export const directoryTreeNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      name: z.string(),
      kind: z.enum(["file", "directory", "symlink", "other"]),
      children: z.array(directoryTreeNodeSchema).optional(),
    })
    .strict(),
);

export const directoryTreeOutputSchema = z
  .object({
    path: z.string(),
    tree: z.array(directoryTreeNodeSchema),
    truncated: z.boolean(),
    entryCount: z.number().int().nonnegative(),
  })
  .strict();

export const readFileTruncationReasonSchema = z.enum([
  "byte_cap",
  "line_range",
  "max_lines",
  "model_budget",
]);

/**
 * Normalize common model mistakes before strict validation:
 * - `line` → `startLine`
 * - drop `head`/`tail` when an explicit range is already present
 */
function normalizeReadFileInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const value = { ...(raw as Record<string, unknown>) };
  if (
    typeof value.line === "number" &&
    Number.isFinite(value.line) &&
    value.startLine === undefined
  ) {
    value.startLine = value.line;
  }
  delete value.line;
  const hasRange =
    value.startLine !== undefined ||
    value.endLine !== undefined ||
    value.maxLines !== undefined;
  if (hasRange) {
    delete value.head;
    delete value.tail;
  }
  return value;
}

export const readFileInputSchema = z.preprocess(
  normalizeReadFileInput,
  z
    .object({
      path: z.string().min(1),
      startLine: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
      maxLines: z.number().int().positive().max(20_000).optional(),
      /** First N lines (alias for startLine=1 + maxLines). Mutually exclusive with tail. */
      head: z.number().int().positive().max(20_000).optional(),
      /** Last N lines when the loaded prefix is complete. Mutually exclusive with head. */
      tail: z.number().int().positive().max(20_000).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        value.startLine !== undefined &&
        value.endLine !== undefined &&
        value.endLine < value.startLine
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "endLine must be >= startLine",
          path: ["endLine"],
        });
      }
      if (value.head !== undefined && value.tail !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "head and tail are mutually exclusive",
          path: ["tail"],
        });
      }
      if (
        value.head !== undefined &&
        (value.startLine !== undefined ||
          value.endLine !== undefined ||
          value.maxLines !== undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "head cannot be combined with startLine/endLine/maxLines",
          path: ["head"],
        });
      }
      if (
        value.tail !== undefined &&
        (value.startLine !== undefined ||
          value.endLine !== undefined ||
          value.maxLines !== undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "tail cannot be combined with startLine/endLine/maxLines",
          path: ["tail"],
        });
      }
    }),
);

export const readFileOutputSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    /** Actual first line included (1-based). */
    startLine: z.number().int().positive(),
    /** Actual last line included (1-based); 0 when content is empty. */
    endLine: z.number().int().nonnegative(),
    totalLines: z.number().int().nonnegative().optional(),
    eof: z.boolean(),
    nextStartLine: z.number().int().positive().optional(),
    truncated: z.boolean(),
    truncationReason: readFileTruncationReasonSchema.optional(),
  })
  .strict();

export const searchFilesInputSchema = z
  .object({
    query: z.string().min(1),
    path: z.string().min(1).default("."),
    maxMatches: z.number().int().positive().max(200).optional(),
    caseSensitive: z.boolean().optional(),
    mode: z.enum(["auto", "literal", "regex"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode !== "regex") {
      return;
    }
    try {
      new RegExp(value.query, value.caseSensitive ? "" : "i");
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof Error
            ? error.message
            : "Invalid regular expression.",
        path: ["query"],
      });
    }
  });

export const searchFilesOutputSchema = z
  .object({
    query: z.string(),
    mode: z.enum(["literal", "regex"]),
    matches: z.array(
      z.object({
        path: z.string(),
        line: z.number().int().positive(),
        text: z.string(),
      }),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const readDiagnosticsInputSchema = z
  .object({
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const readDiagnosticsOutputSchema = z
  .object({
    diagnostics: z.array(
      z.object({
        path: z.string(),
        severity: z.enum(["error", "warning", "info", "hint"]),
        message: z.string(),
        startLine: z.number().int().positive().optional(),
        startColumn: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        endColumn: z.number().int().positive().optional(),
        source: z.string().optional(),
        code: z.string().optional(),
      }),
    ),
  })
  .strict();


export const globFilesInputSchema = z
  .object({
    pattern: z.string().min(1).max(512),
    path: z.string().min(1).default("."),
    maxResults: z.number().int().positive().max(500).optional(),
  })
  .strict();

export const globFilesOutputSchema = z
  .object({
    pattern: z.string(),
    path: z.string(),
    matches: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(["file", "directory", "symlink", "other"]),
      }),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const readManyFilesInputSchema = z
  .object({
    paths: z.array(z.string().min(1)).min(1).max(20),
    maxBytesPerFile: z.number().int().positive().max(128_000).optional(),
    maxLinesPerFile: z.number().int().positive().max(20_000).optional(),
  })
  .strict();

export const readManyFilesOutputSchema = z
  .object({
    files: z.array(
      z
        .object({
          path: z.string(),
          content: z.string().optional(),
          startLine: z.number().int().positive().optional(),
          endLine: z.number().int().nonnegative().optional(),
          totalLines: z.number().int().nonnegative().optional(),
          eof: z.boolean().optional(),
          nextStartLine: z.number().int().positive().optional(),
          truncated: z.boolean(),
          truncationReason: readFileTruncationReasonSchema.optional(),
          error: z.string().optional(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const fileMetadataInputSchema = z
  .object({
    path: z.string().min(1),
    includeHash: z.boolean().optional(),
  })
  .strict();

export const fileMetadataOutputSchema = z
  .object({
    path: z.string(),
    kind: z.enum(["file", "directory", "symlink", "other"]),
    sizeBytes: z.number().int().nonnegative(),
    mtimeMs: z.number().optional(),
    isSymlink: z.boolean(),
    hash: z
      .object({
        algorithm: z.literal("sha256"),
        hex: z.string(),
        truncated: z.boolean(),
      })
      .optional(),
  })
  .strict();

