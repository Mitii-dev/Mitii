import { z } from "zod";

/**
 * ContextBundle — what Enrich fills for Briefcase packing (§11.2).
 * Slices carry cacheClass so prompt-cache layout stays stable.
 */

export const cacheClassSchema = z.enum(["stable", "semi", "volatile"]);
export type CacheClass = z.infer<typeof cacheClassSchema>;

const textSliceSchema = z
  .object({
    text: z.string().default(""),
    tokens: z.number().int().nonnegative().default(0),
    cacheClass: cacheClassSchema.default("stable"),
    omissions: z.array(z.string()).default([]),
  })
  .strict();

const listSliceSchema = z
  .object({
    items: z.array(z.string()).default([]),
    tokens: z.number().int().nonnegative().default(0),
    cacheClass: cacheClassSchema.default("semi"),
    omissions: z.array(z.string()).default([]),
  })
  .strict();

export const contextBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Human one-liner for early packTurn callers. */
    summary: z.string().min(1),
    focusPaths: z.array(z.string()).default([]),
    route: z.string().min(1),
    grantProfile: z.string().min(1),
    projectRules: textSliceSchema.optional(),
    skills: listSliceSchema.optional(),
    memory: listSliceSchema.optional(),
    repoContext: listSliceSchema.optional(),
    decisionBrief: z.string().optional(),
    planRef: z.string().optional(),
    taskListPresent: z.boolean().optional(),
    /** S13 Briefcase peaks — active + previous handoff + plan objective. */
    handoffPeaks: z
      .object({
        activeTaskId: z.string().optional(),
        activeTaskTitle: z.string().optional(),
        previousHandoffSummary: z.string().optional(),
        previousFromTaskId: z.string().optional(),
        planObjective: z.string().optional(),
        nextMustRead: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
    diagnostics: z.array(z.string()).max(32).optional(),
    /** full | light — how this bundle was built. */
    enrichMode: z.enum(["full", "light", "minimal"]).default("minimal"),
    reasonCodes: z.array(z.string()).default([]),
  })
  .strict();

export type ContextBundle = z.infer<typeof contextBundleSchema>;
