import { z } from "zod";

import { intentCuesSchema } from "./IntentCues";
import { scopeVerdictSchema } from "./ScopeVerdict";

/**
 * Best-effort orient pack (§4.5). Grows additively; omissions are OK.
 * Heavy sections (impact / deep memory / rich nav) remain optional-by-design.
 */
export const situationPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    request: z
      .object({
        text: z.string(),
        mode: z.enum(["ask", "plan", "agent"]).optional(),
        intentCues: intentCuesSchema.optional(),
      })
      .strict(),
    host: z
      .object({
        focusedFile: z.string().optional(),
        selection: z
          .object({
            path: z.string(),
            startLine: z.number().optional(),
            endLine: z.number().optional(),
          })
          .optional(),
        cwd: z.string().optional(),
        dirtyPaths: z.array(z.string()).default([]),
        diagnostics: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
    history: z
      .object({
        compactedTurns: z.number().int().nonnegative().optional(),
        digest: z.string().optional(),
        priorRoute: z.string().optional(),
        priorTaskBand: z.string().optional(),
      })
      .strict()
      .optional(),
    pins: z
      .object({
        skillIds: z.array(z.string()).default([]),
        mcpIds: z.array(z.string()).default([]),
        projectRules: z.array(z.string()).default([]),
        userSafetyRules: z.array(z.string()).default([]),
        /** Structured MCP attach list (S1-MCP-RULES) — ids still mirrored in mcpIds. */
        mcpAttachments: z
          .array(
            z
              .object({
                serverId: z.string().min(1),
                summary: z.string().optional(),
                required: z.boolean().default(false),
              })
              .strict(),
          )
          .optional(),
        /** Structured project rule summaries for DirectionAnalysisInput. */
        projectRuleAttachments: z
          .array(
            z
              .object({
                id: z.string().min(1),
                summary: z.string().optional(),
              })
              .strict(),
          )
          .optional(),
        /** Structured user safety rule summaries. */
        userSafetyRuleAttachments: z
          .array(
            z
              .object({
                id: z.string().min(1),
                summary: z.string().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    memory: z
      .object({
        factCount: z.number().int().nonnegative().default(0),
      })
      .strict()
      .optional(),
    git: z
      .object({
        branch: z.string().optional(),
        dirty: z.boolean().optional(),
        recentCommits: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
    workspace: z
      .object({
        rootIds: z.array(z.string()).default([]),
        readiness: z.string().optional(),
      })
      .strict()
      .optional(),
    projects: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
            language: z.string().optional(),
            packageManager: z.string().optional(),
            scripts: z.record(z.string()).optional(),
            testRoots: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .optional(),
    relationships: z
      .array(
        z
          .object({
            fromProjectId: z.string(),
            toProjectId: z.string(),
            type: z.string(),
          })
          .strict(),
      )
      .optional(),
    config: z
      .object({
        pointers: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
    navigation: z
      .object({
        mentionedPaths: z.array(z.string()).default([]),
        surroundings: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
    impact: z
      .object({
        relatedSeeds: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
    scope: scopeVerdictSchema,
    budget: z
      .object({
        windowBand: z.string().optional(),
      })
      .strict()
      .optional(),
    omissions: z.record(z.string()).default({}),
    reasonCodes: z.array(z.string()).default([]),
    /** @deprecated Prefer request.text — kept for early-pipeline callers. */
    requestText: z.string().optional(),
    /** @deprecated Prefer request.mode. */
    mode: z.enum(["ask", "plan", "agent"]).optional(),
  })
  .strict();

export type SituationPack = z.infer<typeof situationPackSchema>;
