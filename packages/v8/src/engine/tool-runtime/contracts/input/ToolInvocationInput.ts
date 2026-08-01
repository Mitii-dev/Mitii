import { z } from "zod";

import { toolGrantSchema } from "../../../../modules/decision-policy";
import { repositoryStateReferenceSchema } from "../../../../modules/repository-state";

import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../constants";

export const toolInvocationInputSchema = z
  .object({
    schemaVersion: z.literal(TOOL_RUNTIME_SCHEMA_VERSION),
    callId: z.string().min(1),
    toolName: z.string().min(1),
    arguments: z.unknown(),
    grant: toolGrantSchema,
    workspaceRoot: z.string().min(1),
    pinnedState: repositoryStateReferenceSchema.optional(),
  })
  .strict();

export type ToolInvocationInput = z.infer<typeof toolInvocationInputSchema>;
