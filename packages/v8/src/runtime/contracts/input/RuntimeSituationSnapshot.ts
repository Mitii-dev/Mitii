import { z } from "zod";

/**
 * Host-supplied situation extras for Orient (desktop / VS Code / CLI).
 * Kept separate from RuntimeStartInput so engine start can carry the same bag.
 */
export const runtimeSituationSnapshotSchema = z
  .object({
    host: z
      .object({
        focusedFile: z.string().optional(),
        cwd: z.string().optional(),
        dirtyPaths: z.array(z.string()).max(64).optional(),
        diagnostics: z.array(z.string()).max(32).optional(),
        selection: z
          .object({
            path: z.string(),
            startLine: z.number().optional(),
            endLine: z.number().optional(),
          })
          .optional(),
      })
      .strict()
      .optional(),
    git: z
      .object({
        branch: z.string().optional(),
        dirty: z.boolean().optional(),
        recentCommits: z.array(z.string()).max(16).optional(),
      })
      .strict()
      .optional(),
    catalog: z
      .object({
        projects: z
          .array(
            z
              .object({
                id: z.string().min(1),
                name: z.string().optional(),
                language: z.string().optional(),
                packageManager: z.string().optional(),
                scripts: z.record(z.string()).optional(),
                testRoots: z.array(z.string()).optional(),
              })
              .strict(),
          )
          .max(64)
          .optional(),
        configPointers: z.array(z.string()).max(64).optional(),
        relationships: z
          .array(
            z
              .object({
                fromProjectId: z.string().min(1),
                toProjectId: z.string().min(1),
                type: z.enum([
                  "workspace_member",
                  "depends_on",
                  "development_depends_on",
                ]),
              })
              .strict(),
          )
          .max(128)
          .optional(),
      })
      .strict()
      .optional(),
    impact: z
      .object({
        relatedSeeds: z.array(z.string()).max(64).optional(),
      })
      .strict()
      .optional(),
    memory: z
      .object({
        factCount: z.number().int().nonnegative().default(0),
      })
      .strict()
      .optional(),
    projectRuleIds: z.array(z.string().min(1)).max(32).optional(),
  })
  .strict();

export type RuntimeSituationSnapshot = z.infer<
  typeof runtimeSituationSnapshotSchema
>;
