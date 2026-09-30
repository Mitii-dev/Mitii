import { z } from "zod";

export const runReadonlyCommandInputSchema = z
  .object({
    argv: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const runReadonlyCommandOutputSchema = z
  .object({
    argv: z.array(z.string()),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export const fetchUrlInputSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  // Models often invent maxBytes; map it onto the real maxLength window.
  if (obj.maxLength === undefined && obj.maxBytes !== undefined) {
    const n =
      typeof obj.maxBytes === "number"
        ? obj.maxBytes
        : typeof obj.maxBytes === "string"
          ? Number(obj.maxBytes)
          : Number.NaN;
    if (Number.isFinite(n) && n > 0) {
      obj.maxLength = Math.floor(n);
    }
  }
  delete obj.maxBytes;
  return obj;
}, z
  .object({
    url: z.string().url(),
    /** Byte/char offset into the fetched body for continuation windows. */
    startIndex: z.number().int().nonnegative().optional(),
    /** Max characters to return from startIndex (servers-main fetch pagination). */
    maxLength: z.number().int().positive().max(1_000_000).optional(),
    /**
     * `autonomous` (default) respects robots.txt; `user` skips robots for
     * explicit user-requested URLs (servers-main fetch policy split).
     */
    intent: z.enum(["autonomous", "user"]).optional(),
  })
  // Strip other invented keys (models often add maxBytes/headers) instead of
  // hard-failing the whole fetch_url call.
  .strip());

export const fetchUrlOutputSchema = z
  .object({
    url: z.string(),
    status: z.number().int(),
    body: z.string(),
    truncated: z.boolean(),
    startIndex: z.number().int().nonnegative(),
    /** Present when more content remains — call again with this as startIndex. */
    nextStartIndex: z.number().int().nonnegative().optional(),
    totalLength: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Coerce LLM stringified booleans while keeping JSON Schema `required`. */
export const coercedBooleanSchema = z.union([
  z.boolean(),
  z
    .string()
    .transform((value, ctx) => {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected boolean or "true"/"false"',
      });
      return z.NEVER;
    }),
]);

export const sequentialThinkingInputSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  // Models often omit counters on the first thought; default instead of NaN reject.
  if (obj.thoughtNumber === undefined || obj.thoughtNumber === null || obj.thoughtNumber === "") {
    obj.thoughtNumber = 1;
  }
  if (obj.totalThoughts === undefined || obj.totalThoughts === null || obj.totalThoughts === "") {
    obj.totalThoughts = obj.thoughtNumber ?? 1;
  }
  if (obj.nextThoughtNeeded === undefined || obj.nextThoughtNeeded === null || obj.nextThoughtNeeded === "") {
    obj.nextThoughtNeeded = true;
  }
  return obj;
}, z
  .object({
    thought: z.string().min(1).max(32_000),
    thoughtNumber: z.coerce.number().int().positive(),
    totalThoughts: z.coerce.number().int().positive(),
    nextThoughtNeeded: coercedBooleanSchema,
    isRevision: coercedBooleanSchema.optional(),
    revisesThought: z.coerce.number().int().positive().optional(),
    branchFromThought: z.coerce.number().int().positive().optional(),
    branchId: z.string().min(1).max(256).optional(),
    needsMoreThoughts: coercedBooleanSchema.optional(),
  })
  .strip());

export const sequentialThinkingOutputSchema = z
  .object({
    thoughtNumber: z.number().int().positive(),
    totalThoughts: z.number().int().positive(),
    nextThoughtNeeded: z.boolean(),
    branches: z.array(z.string()),
    thoughtHistoryLength: z.number().int().nonnegative(),
  })
  .strict();

export const getCurrentTimeInputSchema = z
  .object({
    timezone: z.string().min(1).max(128).optional(),
  })
  .strict();

export const timeSnapshotSchema = z
  .object({
    timezone: z.string(),
    datetime: z.string(),
    dayOfWeek: z.string(),
    isDst: z.boolean(),
  })
  .strict();

export const getCurrentTimeOutputSchema = timeSnapshotSchema;

export const convertTimeInputSchema = z
  .object({
    sourceTimezone: z.string().min(1).max(128),
    time: z.string().min(1).max(16),
    targetTimezone: z.string().min(1).max(128),
  })
  .strict();

export const convertTimeOutputSchema = z
  .object({
    source: timeSnapshotSchema,
    target: timeSnapshotSchema,
    timeDifference: z.string(),
  })
  .strict();

export const webSearchInputSchema = z
  .object({
    query: z.string().min(1).max(500),
    maxResults: z.number().int().positive().max(10).optional(),
  })
  .strict();

export const webSearchOutputSchema = z
  .object({
    query: z.string(),
    results: z.array(
      z
        .object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
          publishedAt: z.string().optional(),
          source: z.string().optional(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const readPackageScriptsInputSchema = z
  .object({
    path: z.string().min(1).default("package.json"),
  })
  .strict();

export const readPackageScriptsOutputSchema = z
  .object({
    path: z.string(),
    scripts: z.record(z.string()),
    packageManager: z.string().optional(),
    truncated: z.boolean(),
  })
  .strict();

