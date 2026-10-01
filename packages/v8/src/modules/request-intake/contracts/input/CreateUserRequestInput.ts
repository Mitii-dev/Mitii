import { z } from "zod";

import { agentModeSchema } from "../../interaction-mode/schema";
import {
  requestArtifactReferenceSchema,
  requestImageAttachmentSchema,
  requestMetaCommandSchema,
  userRequestCorrelationSchema,
  userRequestWorkspaceScopeSchema,
} from "../../request-envelope/schema";
import {
  REQUEST_ENVELOPE_LIMITS,
  REQUEST_ENVELOPE_MESSAGES,
  REQUEST_SESSION_ACTIONS,
  REQUEST_TURN_KINDS,
  USER_REQUEST_ORIGINS,
} from "../../request-envelope/constants";

/**
 * Boundary input for RequestIntakePipeline.
 * Message/artifact limits and content rules mirror UserRequestEnvelope so
 * invalid requests fail at the first public boundary (including engine start).
 *
 * Hosts may pre-fill structured fields (mode, turnKind, artifacts, attachments).
 * Intake injects parse stages on top of this shape before building the envelope.
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
    turnKind: z.enum(REQUEST_TURN_KINDS).optional(),
    sessionAction: z.enum(REQUEST_SESSION_ACTIONS).optional(),
    parentRequestId: z.string().min(1).optional(),
    /**
     * Host-preclassified meta command. Intake also detects leading slash
     * commands; host value wins when both are present.
     */
    metaCommand: requestMetaCommandSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      !input.userMessage.trim() &&
      (input.referencedArtifacts?.length ?? 0) === 0 &&
      !input.metaCommand
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
