import { z } from "zod";

import { intentCuesSchema } from "./IntentCues";
import { scopeVerdictSchema } from "./ScopeVerdict";

/**
 * Best-effort orient pack (§4.5). Grows additively; omissions are OK.
 * Heavy sections stay optional until their S1-* owners wire them.
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
            language: z.string().optional(),
            packageManager: z.string().optional(),
            scripts: z.record(z.string()).optional(),
            testRoots: z.array(z.string()).optional(),
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
