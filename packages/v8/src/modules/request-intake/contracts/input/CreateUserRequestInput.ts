import { z } from "zod";

import { agentModeSchema } from "../../interaction-mode/schema";
import {
  requestArtifactReferenceSchema,
  requestImageAttachmentSchema,
  userRequestCorrelationSchema,
  userRequestWorkspaceScopeSchema,
} from "../../request-envelope/schema";
import {
  REQUEST_ENVELOPE_LIMITS,
  REQUEST_ENVELOPE_MESSAGES,
  USER_REQUEST_ORIGINS,
} from "../../request-envelope/constants";

/**
 * Boundary input for RequestIntakePipeline.
 * Message/artifact limits and content rules mirror UserRequestEnvelope so
 * invalid requests fail at the first public boundary (including engine start).
 */
export const createUserRequestInputSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    sessionId: z.string().min(1),
    mode: agentModeSchema,
    origin: z.enum(USER_REQUEST_ORIGINS).optional(),
    userMessage: z
      .string()
      .max(REQUEST_ENVELOPE_LIMITS.MAXIMUM_MESSAGE_CHARACTERS),
    referencedArtifacts: z
      .array(requestArtifactReferenceSchema)
      .max(REQUEST_ENVELOPE_LIMITS.MAXIMUM_REFERENCED_ARTIFACTS)
      .optional(),
    workspace: userRequestWorkspaceScopeSchema.optional(),
    correlation: userRequestCorrelationSchema.optional(),
    attachments: z
      .array(requestImageAttachmentSchema)
      .max(REQUEST_ENVELOPE_LIMITS.MAXIMUM_ATTACHMENTS)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      !input.userMessage.trim() &&
      (input.referencedArtifacts?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userMessage"],
        message: REQUEST_ENVELOPE_MESSAGES.REQUEST_REQUIRES_CONTENT,
      });
    }
  });

export type CreateUserRequestInput = z.infer<
  typeof createUserRequestInputSchema
>;
