import { z } from "zod";

/** Minimal start shape for the new runtime — expands as contracts migrate. */
export const runtimeStartInputSchema = z
  .object({
    runId: z.string().min(1).optional(),
    message: z.string().min(1),
    /** Host-advertised window; discovery budgets must rise with this (§6.5). */
    contextWindowTokens: z.number().int().positive().optional(),
    /** Host MCP servers already attached before start. */
    mcpServerIds: z.array(z.string().min(1)).max(32).optional(),
    /** Required skill pins from host. */
    requiredSkillIds: z.array(z.string().min(1)).max(32).optional(),
    /** Alias for mcpServerIds (host naming). */
    requiredMcpServerIds: z.array(z.string().min(1)).max(32).optional(),
    /** Host editor / workspace snapshot (S1-HOST). */
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
    /** Compacted history / prior route (S1-HISTORY). */
    history: z
      .object({
        compactedTurns: z.number().int().nonnegative().optional(),
        digest: z.string().max(4000).optional(),
        priorRoute: z.string().optional(),
        priorTaskBand: z.string().optional(),
      })
      .strict()
      .optional(),
    /** Best-effort git snapshot from host (S1-GIT). */
    git: z
      .object({
        branch: z.string().optional(),
        dirty: z.boolean().optional(),
        recentCommits: z.array(z.string()).max(16).optional(),
      })
      .strict()
      .optional(),
    /** Memory retrieve count / empty OK (S1-MOVE-MEM-SKILL seam). */
    memory: z
      .object({
        factCount: z.number().int().nonnegative().default(0),
      })
      .strict()
      .optional(),
    turnKind: z
      .enum(["new", "continue", "steer", "follow_up", "recover"])
      .optional(),
    /** Project rule ids from host instructions (pins). */
    projectRuleIds: z.array(z.string().min(1)).max(32).optional(),
    /** Safety deny-tool / deny-path ids for early pins (S1-MCP-RULES). */
    userSafetyRuleIds: z.array(z.string().min(1)).max(32).optional(),
    /** Catalog slice for Orient (S1-CATALOG) — host/precomputed. */
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
    /** Optional impact awareness seeds (S1-IMPACT) — not fences. */
    impact: z
      .object({
        relatedSeeds: z.array(z.string()).max(64).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RuntimeStartInput = z.infer<typeof runtimeStartInputSchema>;
