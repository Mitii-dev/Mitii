import { z } from "zod";

import { TOOL_RUNTIME_SCHEMA_VERSION, TOOL_RESULT_STATUSES } from "../../constants";
import { toolReasonCodeSchema } from "../errors/ToolRuntimeErrors";

export const toolResultStatusSchema = z.enum(TOOL_RESULT_STATUSES);

export const toolAuditEventSchema = z
  .object({
    callId: z.string().min(1),
    toolName: z.string().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    status: toolResultStatusSchema,
    reasonCode: toolReasonCodeSchema.optional(),
    path: z.string().optional(),
    argv: z.array(z.string()).optional(),
    inputPreview: z.string(),
    outputPreview: z.string().optional(),
    bytesProduced: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    truncated: z.boolean(),
    redacted: z.boolean(),
  })
  .strict();

export type ToolAuditEvent = z.infer<typeof toolAuditEventSchema>;

export const toolResultSchema = z
  .object({
    schemaVersion: z.literal(TOOL_RUNTIME_SCHEMA_VERSION),
    callId: z.string().min(1),
    toolName: z.string().min(1),
    status: toolResultStatusSchema,
    reasonCode: toolReasonCodeSchema.optional(),
    output: z.unknown().optional(),
    truncated: z.boolean(),
    redacted: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    bytesProduced: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    audit: toolAuditEventSchema,
  })
  .strict();

export type ToolResult = z.infer<typeof toolResultSchema>;
export type ToolResultStatus = z.infer<typeof toolResultStatusSchema>;
