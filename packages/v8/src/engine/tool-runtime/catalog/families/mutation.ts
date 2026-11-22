import { z } from "zod";

import { MAX_APPLY_PATCH_PATCHES } from "../../defaults";

export const structuredPatchSchema = z
  .object({
    path: z.string().min(1, "path is required"),
    oldText: z.string({ required_error: "oldText is required" }),
    newText: z.string({ required_error: "newText is required" }),
    expectedHash: z.string().min(1).optional(),
    replaceAll: z.boolean().optional(),
    fuzzyMatch: z.boolean().optional(),
  })
  .strict();

export const applyPatchInputSchema = z
  .object({
    patches: z.array(structuredPatchSchema).min(1).max(MAX_APPLY_PATCH_PATCHES),
    /** When true, validate and preview without writing files. */
    dryRun: z.boolean().optional(),
  })
  .strict();

export const applyPatchOutputSchema = z
  .object({
    checkpointId: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    applied: z.array(
      z
        .object({
          path: z.string(),
          created: z.boolean(),
          bytesWritten: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    /** Present when dryRun validated patches without writing. */
    dryRun: z.boolean().optional(),
    /** Diagnostics newly introduced after the patch (host DiagnosticsPort). */
    newDiagnostics: z
      .array(
        z
          .object({
            path: z.string().min(1),
            severity: z.enum(["error", "warning", "info", "hint"]),
            message: z.string().min(1),
            startLine: z.number().int().positive().optional(),
            startColumn: z.number().int().positive().optional(),
            endLine: z.number().int().positive().optional(),
            endColumn: z.number().int().positive().optional(),
            source: z.string().min(1).optional(),
            code: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
    /**
     * Structured post-edit diagnostics summary (settle + severity counts).
     * Present when a DiagnosticsPort is injected and the patch changed files.
     */
    postEditDiagnostics: z
      .object({
        settled: z.boolean(),
        errorCount: z.number().int().nonnegative(),
        warningCount: z.number().int().nonnegative(),
        infoCount: z.number().int().nonnegative(),
        hintCount: z.number().int().nonnegative(),
        requiresRepair: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const deleteFileInputSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

export const deleteFileOutputSchema = z
  .object({
    checkpointId: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    path: z.string().min(1),
  })
  .strict();

export const deleteDirectoryInputSchema = z
  .object({
    path: z.string().min(1),
    recursive: z.boolean().optional(),
  })
  .strict();

export const deleteDirectoryOutputSchema = z
  .object({
    checkpointId: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    path: z.string().min(1),
    recursive: z.boolean(),
  })
  .strict();

export const moveFileInputSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export const moveFileOutputSchema = z
  .object({
    checkpointId: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export const runCommandInputSchema = z
  .object({
    argv: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const runCommandOutputSchema = z
  .object({
    argv: z.array(z.string()),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export const createGithubIssueInputSchema = z
  .object({
    title: z.string().min(1).max(256),
    body: z.string().min(1).max(65_536),
    labels: z.array(z.string().min(1).max(64)).max(20).optional(),
    assignees: z.array(z.string().min(1).max(64)).max(10).optional(),
    /**
     * When set, search open issues for `[mitii:<fingerprint>]` and comment
     * instead of creating a duplicate (idempotent triage).
     */
    fingerprint: z.string().min(4).max(64).optional(),
  })
  .strict();

export const createPullRequestInputSchema = z
  .object({
    title: z.string().min(1).max(256),
    body: z.string().min(1).max(65_536),
    head: z.string().min(1).max(256),
    base: z.string().min(1).max(256).default("main"),
    draft: z.boolean().optional(),
  })
  .strict();

/** Add Signed-off-by to every commit after `base` (exclusive) via rebase --exec. */
export const gitSignoffRangeInputSchema = z
  .object({
    /** Exclusive base ref/sha (e.g. merge-base or the commit named in the DCO error). */
    base: z.string().min(1).max(256),
    /** When true, `git push --force-with-lease` current branch to remote after rebase. */
    push: z.boolean().optional(),
    /** Remote name for push (default origin). */
    remote: z.string().min(1).max(64).optional(),
  })
  .strict();

export const gitSignoffRangeOutputSchema = z
  .object({
    argv: z.array(z.string()),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
    stashed: z.boolean().optional(),
    pushed: z.boolean().optional(),
    branch: z.string().optional(),
    signedOffCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const githubMutationOutputSchema = z
  .object({
    argv: z.array(z.string()),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
    url: z.string().optional(),
    /** True when a new issue/PR was created; false when an existing issue was updated. */
    created: z.boolean().optional(),
    issueNumber: z.number().int().positive().optional(),
  })
  .strict();

