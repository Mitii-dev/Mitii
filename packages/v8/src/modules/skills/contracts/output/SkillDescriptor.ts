import { z } from "zod";

import { executionRouteSchema } from "../../../decision-policy";

export const skillDescriptorSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    content: z.string().min(1),
    /** Task intents this skill applies to (e.g. bugfix, review). */
    intents: z.array(z.string().min(1)).default([]),
    /** Execution routes this skill applies to. Empty = any route. */
    routes: z.array(executionRouteSchema).default([]),
    /** Free-form tags matched against the user query. */
    tags: z.array(z.string().min(1)).default([]),
    /** Higher wins when multiple skills compete. */
    priority: z.number().int().nonnegative().default(100),
    /** When set, only one skill from the group may be selected. */
    conflictGroup: z.string().min(1).optional(),
    /** Loaded whenever score thresholds are otherwise unmet. */
    alwaysApply: z.boolean().default(false),
  })
  .strict();

export type SkillDescriptor = z.infer<typeof skillDescriptorSchema>;
