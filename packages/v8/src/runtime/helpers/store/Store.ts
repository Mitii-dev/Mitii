import { z } from "zod";

/**
 * Live SSOT for one runId (§0.1). StoreManager is the only writer.
 * Fields grow as phases evacuate — keep this schema additive.
 */
export const storeSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    cancelling: z.boolean().default(false),
    // Populated by later phases (situation, decision, plan, …)
    slices: z.record(z.unknown()).default({}),
  })
  .strict();

export type Store = z.infer<typeof storeSchema>;

export function createEmptyStore(input: {
  runId: string;
  nowIso: string;
}): Store {
  return storeSchema.parse({
    schemaVersion: 1,
    runId: input.runId,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    cancelling: false,
    slices: {},
  });
}
