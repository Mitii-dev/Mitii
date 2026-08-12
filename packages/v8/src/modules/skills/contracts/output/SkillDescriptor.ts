import { z } from "zod";

import { executionRouteSchema } from "../../../decision-policy";

export const skillResourceManifestSchema = z
  .object({
    references: z.array(z.string().min(1)).default([]),
    scripts: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type SkillResourceManifest = z.infer<typeof skillResourceManifestSchema>;

export const skillIndexEntrySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    /**
     * Back-compat field for older in-memory catalogs. Progressive catalogs keep
     * this out of L1 and provide it through `loadBody(id)` instead.
     */
    content: z.string().min(1).optional(),
    /** Task intents this skill applies to (e.g. bugfix, review). */
    intents: z.array(z.string().min(1)).default([]),
    /** Execution routes this skill applies to. Empty = any route. */
    routes: z.array(executionRouteSchema).default([]),
    /** Free-form tags matched against the user query. */
    tags: z.array(z.string().min(1)).default([]),
    /**
     * Optional repository path globs that gate this skill. Empty = any path.
     *
     * Hosts may map disk `paths:` frontmatter into this field, but Skills still
     * never reads the filesystem directly.
     */
    paths: z.array(z.string().min(1)).default([]),
    /** Soft language evidence. Boost only — never sole authority. */
    languages: z.array(z.string().min(1)).default([]),
    /** Soft project-kind evidence. Boost only — never sole authority. */
    projectKinds: z.array(z.string().min(1)).default([]),
    /** Higher wins when multiple skills compete. */
    priority: z.number().int().nonnegative().default(100),
    /** When set, only one skill from the group may be selected. */
    conflictGroup: z.string().min(1).optional(),
    /** Loaded whenever score thresholds are otherwise unmet. */
    alwaysApply: z.boolean().default(false),
    resources: skillResourceManifestSchema.optional(),
  })
  .strict();

export type SkillIndexEntry = z.infer<typeof skillIndexEntrySchema>;

export const skillBodySchema = z
  .object({
    content: z.string().min(1),
    resources: skillResourceManifestSchema.optional(),
  })
  .strict();

export type SkillBody = z.infer<typeof skillBodySchema>;

export const skillDescriptorSchema = skillIndexEntrySchema.extend({
  content: z.string().min(1),
});

export type SkillDescriptor = z.infer<typeof skillDescriptorSchema>;
