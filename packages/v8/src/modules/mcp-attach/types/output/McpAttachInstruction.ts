import { z } from "zod";

export const mcpAttachInstructionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    priority: z.number(),
    content: z.string().min(1),
  })
  .strict();

export type McpAttachInstruction = z.infer<typeof mcpAttachInstructionSchema>;
