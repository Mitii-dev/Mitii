import { z } from "zod";

/** Append-only tool history entry (§20.2). */
export const toolInvocationRecordSchema = z
  .object({
    invocationId: z.string().min(1),
    toolId: z.string().min(1),
    taskId: z.string().optional(),
    idempotencyKey: z.string().min(1),
    status: z.enum([
      "pending",
      "succeeded",
      "failed",
      "cancelled",
      "uncertain",
    ]),
    inputHash: z.string().min(1),
    effectClass: z.enum(["none", "read", "mutate", "external"]),
    startedAt: z.string().min(1),
    finishedAt: z.string().optional(),
  })
  .strict();

export type ToolInvocationRecord = z.infer<typeof toolInvocationRecordSchema>;
