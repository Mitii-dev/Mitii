import { z } from "zod";

import { endingPostureSchema } from "../../../modules/request-understanding/contracts/continuity/EndingPosture";
import { taskListSchema } from "../../../modules/task-list";

/** Minimal start shape for the new runtime — expands as contracts migrate. */
export const runtimeStartInputSchema = z
  .object({
    runId: z.string().min(1).optional(),
    /**
     * Host thread / chat id — used to load/save dialogue continuity across
     * runs (priorRoute + endingPosture). Distinct from runId.
     */
    sessionId: z.string().min(1).optional(),
    message: z.string().min(1),
    /**
     * Host approval preset (safe / guided / pilot → every_mutation /
     * when_required / never). Applied onto the compiled tool grant.
     */
    approvalMode: z
      .enum(["never", "when_required", "every_mutation"])
      .optional(),
    /**
     * Host thoroughness (low / medium / high → quick / auto / deep).
     * Influences turn-loop discovery budget.
     */
    explorationDepth: z.enum(["auto", "quick", "deep"]).optional(),
    /** Host-advertised window; discovery budgets must rise with this (§6.5). */
    contextWindowTokens: z.number().int().positive().optional(),
    /** Host MCP servers already attached before start. */
    mcpServerIds: z.array(z.string().min(1)).max(32).optional(),
    /** Required skill pins from host. */
    requiredSkillIds: z.array(z.string().min(1)).max(32).optional(),
    /** Alias for mcpServerIds (host naming). */
    requiredMcpServerIds: z.array(z.string().min(1)).max(32).optional(),
    /**
     * Explicit file/folder pins from the host composer (@ attach / pin chips).
     * Orient treats these as focus roots even when the user message is vague
     * ("explain this").
     */
    pinnedPaths: z.array(z.string().min(1)).max(32).optional(),
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
    /** Compacted history / prior route (S1-HISTORY + continuity bias). */
    history: z
      .object({
        compactedTurns: z.number().int().nonnegative().optional(),
        digest: z.string().max(4000).optional(),
        priorRoute: z.string().optional(),
        priorTaskBand: z.string().optional(),
        endingPosture: endingPostureSchema.optional(),
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
    /**
     * Prior session transcript (host/SDK). Used for follow-up packing and
     * turnKind inference — not a substitute for `message`.
     */
    conversation: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant", "system", "tool"]),
            content: z.string(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    /** Project rule ids from host instructions (pins). */
    projectRuleIds: z.array(z.string().min(1)).max(32).optional(),
    /** Optional summaries for project rules (S1-MCP-RULES). */
    projectRuleAttachments: z
      .array(
        z
          .object({
            id: z.string().min(1),
            summary: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    /** Safety deny-tool / deny-path ids for early pins (S1-MCP-RULES). */
    userSafetyRuleIds: z.array(z.string().min(1)).max(32).optional(),
    /** Optional summaries for safety rules. */
    userSafetyRuleAttachments: z
      .array(
        z
          .object({
            id: z.string().min(1),
            summary: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    /** Optional MCP attach summaries (serverId + summary). */
    mcpAttachments: z
      .array(
        z
          .object({
            serverId: z.string().min(1),
            summary: z.string().max(500).optional(),
            required: z.boolean().optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    /** Paths that require hard caution / approval (S2-SCOPE protectedPaths). */
    protectedPaths: z.array(z.string().min(1)).max(64).optional(),
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
    /**
     * Durable campaign checklist from the host (prior turn). Hydrated into
     * the store so Continue / next-slice does not re-plan from scratch.
     */
    taskList: taskListSchema.optional(),
    /** Plan step ids already completed across prior turns. */
    completedPlanStepIds: z.array(z.string().min(1)).max(64).optional(),
  })
  .strict();

export type RuntimeStartInput = z.infer<typeof runtimeStartInputSchema>;
