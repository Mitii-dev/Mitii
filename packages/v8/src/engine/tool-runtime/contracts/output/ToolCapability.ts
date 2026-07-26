import { z } from "zod";

import { TOOL_BACKENDS, TOOL_EFFECTS } from "../../constants";

export const toolBackendSchema = z.enum(TOOL_BACKENDS);
export const toolEffectSchema = z.enum(TOOL_EFFECTS);

export const toolCapabilityStatusSchema = z.enum([
  "available",
  "degraded",
  "unavailable",
]);

export const toolCapabilityDescriptorSchema = z
  .object({
    name: z.string().min(1),
    effects: z.array(toolEffectSchema).min(1),
    backend: toolBackendSchema,
    status: toolCapabilityStatusSchema,
    timeoutMs: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
    description: z.string().min(1),
  })
  .strict();

export type ToolCapabilityDescriptor = z.infer<
  typeof toolCapabilityDescriptorSchema
>;
export type ToolBackend = z.infer<typeof toolBackendSchema>;
export type ToolEffect = z.infer<typeof toolEffectSchema>;
