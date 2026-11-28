import { z } from "zod";

/** Deterministic intent cues extracted at Orient (§4 / S1-CUES). */
export const intentCuesSchema = z
  .object({
    readOnlyAsk: z.boolean().default(false),
    explicitEditLimit: z.boolean().default(false),
    pastedErrorOrStack: z.boolean().default(false),
    createAsk: z.boolean().default(false),
    debugAsk: z.boolean().default(false),
    constraintSnippets: z.array(z.string()).default([]),
  })
  .strict();

export type IntentCues = z.infer<typeof intentCuesSchema>;
