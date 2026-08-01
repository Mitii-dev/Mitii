import { z } from "zod";

import { agentModeSchema } from "../../interaction-mode/schema";
import {
  requestArtifactReferenceSchema,
  userRequestCorrelationSchema,
  userRequestWorkspaceScopeSchema,
} from "../../request-envelope/schema";
import { USER_REQUEST_ORIGINS } from "../../request-envelope/constants";

/**
 * Boundary input for RequestIntakePipeline.
 * Field shapes match CreateUserRequestInput / envelope contracts — no unknown drift.
 */
export const createUserRequestInputSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    sessionId: z.string().min(1),
    mode: agentModeSchema,
    origin: z.enum(USER_REQUEST_ORIGINS).optional(),
    userMessage: z.string(),
    referencedArtifacts: z.array(requestArtifactReferenceSchema).optional(),
    workspace: userRequestWorkspaceScopeSchema.optional(),
    correlation: userRequestCorrelationSchema.optional(),
  })
  .strict();

export type CreateUserRequestInput = z.infer<
  typeof createUserRequestInputSchema
>;
