import { z } from "zod";

import { agentModeSchema } from "../../interaction-mode/schema";

/**
 * Boundary input for RequestIntakePipeline.
 * Full envelope validation remains owned by userRequestEnvelopeSchema.
 */
export const createUserRequestInputSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    sessionId: z.string().min(1),
    mode: agentModeSchema,
    origin: z.enum(["user", "automation", "api"]).optional(),
    userMessage: z.string(),
    referencedArtifacts: z.array(z.unknown()).optional(),
    workspace: z.unknown().optional(),
    correlation: z.unknown().optional(),
  })
  .strict();

export type CreateUserRequestInputContract = z.infer<
  typeof createUserRequestInputSchema
>;
