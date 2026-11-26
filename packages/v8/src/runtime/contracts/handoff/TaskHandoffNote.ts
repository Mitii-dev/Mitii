import { z } from "zod";

/**
 * Linked-list handoff between TaskList items (§13 / S13).
 * Not a second plan and not an ImpactMap.
 */

export const taskHandoffNoteSchema = z
  .object({
    schemaVersion: z.literal(1),
    fromTaskId: z.string().min(1),
    toTaskId: z.string().min(1).optional(),
    /** ≤2 sentences — what changed. */
    doneSummary: z.string().min(1).max(480),
    artifactsWritten: z.array(z.string().min(1)).max(32).default([]),
    evidenceRefs: z.array(z.string().min(1)).max(32).default([]),
    blockersRemaining: z.array(z.string().min(1)).max(16).default([]),
    nextMustRead: z.array(z.string().min(1)).max(16).default([]),
    assumptions: z.array(z.string().min(1)).max(16).default([]),
    impactSiteIds: z.array(z.string().min(1)).max(32).optional(),
  })
  .strict();

export type TaskHandoffNote = z.infer<typeof taskHandoffNoteSchema>;
