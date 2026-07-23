import { z } from "zod";

import { BOUNDED_WALK_WARNING_CODES } from "../shared";

const canonicalRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), {
    message: "relativePath must not begin with '/'.",
  })
  .refine((value) => !value.includes("\\"), {
    message: "relativePath must use forward slashes.",
  })
  .refine(
    (value) =>
      !value.split("/").some((segment) => segment === "." || segment === ".."),
    {
      message: "relativePath must not contain '.' or '..' segments.",
    },
  );

const utcTimestampSchema = z.string().datetime({
  offset: false,
});

const workspaceRootKindSchema = z.enum(["directory", "file", "unavailable"]);

const workspaceRootSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  providerPath: z.string().min(1).optional(),
  kind: workspaceRootKindSchema,
});

const workspaceEntryBaseSchema = z.object({
  rootId: z.string().min(1),
  relativePath: canonicalRelativePathSchema,
  providerPath: z.string().min(1).optional(),
  depth: z.number().int().nonnegative(),
});

const workspaceFileEntrySchema = workspaceEntryBaseSchema.extend({
  kind: z.literal("file"),
  size: z.number().int().nonnegative().optional(),
  modifiedAt: utcTimestampSchema.optional(),
  contentHash: z.string().min(1).optional(),
});

const workspaceDirectoryEntrySchema = workspaceEntryBaseSchema.extend({
  kind: z.literal("directory"),
});

const workspaceSymbolicLinkEntrySchema = workspaceEntryBaseSchema.extend({
  kind: z.literal("symbolic_link"),
  size: z.number().int().nonnegative().optional(),
  modifiedAt: utcTimestampSchema.optional(),
  linkTarget: z.string().min(1).optional(),
});

const workspaceOtherEntrySchema = workspaceEntryBaseSchema.extend({
  kind: z.literal("other"),
});

export const workspaceEntrySchema = z.discriminatedUnion("kind", [
  workspaceFileEntrySchema,
  workspaceDirectoryEntrySchema,
  workspaceSymbolicLinkEntrySchema,
  workspaceOtherEntrySchema,
]);

const workspaceWarningCodeSchema = z.enum(BOUNDED_WALK_WARNING_CODES);

const workspaceSnapshotWarningSchema = z.object({
  code: workspaceWarningCodeSchema,
  path: z.string(),
  message: z.string().min(1),
});

const workspaceSnapshotStatisticsSchema = z.object({
  files: z.number().int().nonnegative(),
  directories: z.number().int().nonnegative(),
  symbolicLinks: z.number().int().nonnegative(),
  otherEntries: z.number().int().nonnegative(),
  ignoredEntries: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

const workspaceSnapshotLimitsSchema = z.object({
  maximumDepth: z.number().int().nonnegative(),
  maximumFiles: z.number().int().positive(),
  maximumDirectories: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  followSymbolicLinks: z.boolean(),
});

const workspaceSnapshotStatusSchema = z.enum([
  "complete",
  "partial",
  "cancelled",
  "timed_out",
]);

export const workspaceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),

    roots: z.array(workspaceRootSchema),

    entries: z.array(workspaceEntrySchema),

    warnings: z.array(workspaceSnapshotWarningSchema),

    statistics: workspaceSnapshotStatisticsSchema,

    limits: workspaceSnapshotLimitsSchema,

    status: workspaceSnapshotStatusSchema,

    generatedAt: utcTimestampSchema,
  })
  .superRefine((snapshot, context) => {
    const rootIds = new Set<string>();

    for (const root of snapshot.roots) {
      if (rootIds.has(root.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roots"],
          message: `Duplicate workspace root ID: "${root.id}".`,
        });
      }

      rootIds.add(root.id);
    }

    for (let index = 0; index < snapshot.entries.length; index += 1) {
      const entry = snapshot.entries[index];

      if (!rootIds.has(entry.rootId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "rootId"],
          message: `Entry references unknown root ID ` + `"${entry.rootId}".`,
        });
      }
    }

    const actualFiles = snapshot.entries.filter(
      (entry) => entry.kind === "file",
    ).length;

    const actualDirectories = snapshot.entries.filter(
      (entry) => entry.kind === "directory",
    ).length;

    const actualSymbolicLinks = snapshot.entries.filter(
      (entry) => entry.kind === "symbolic_link",
    ).length;

    const actualOtherEntries = snapshot.entries.filter(
      (entry) => entry.kind === "other",
    ).length;

    if (snapshot.statistics.files !== actualFiles) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statistics", "files"],
        message: "File count does not match entries.",
      });
    }

    if (snapshot.statistics.directories !== actualDirectories) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statistics", "directories"],
        message: "Directory count does not match entries.",
      });
    }

    if (snapshot.statistics.symbolicLinks !== actualSymbolicLinks) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statistics", "symbolicLinks"],
        message: "Symbolic-link count does not match entries.",
      });
    }

    if (snapshot.statistics.otherEntries !== actualOtherEntries) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statistics", "otherEntries"],
        message: "Other-entry count does not match entries.",
      });
    }

    if (snapshot.statistics.warnings !== snapshot.warnings.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statistics", "warnings"],
        message: "Warning count does not match warnings array.",
      });
    }
  });
