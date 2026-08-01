import { z } from "zod";

import {
  MEMORY_PRIVACY_LEVELS,
  MEMORY_SCOPES,
} from "../../constants";

export const memoryScopeSchema = z
  .object({
    kind: z.enum(MEMORY_SCOPES),
    userId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "user" && !value.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "user scope requires userId.",
        path: ["userId"],
      });
    }
    if (value.kind === "workspace" && !value.workspaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "workspace scope requires workspaceId.",
        path: ["workspaceId"],
      });
    }
    if (value.kind === "project" && !value.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "project scope requires projectId.",
        path: ["projectId"],
      });
    }
  });

export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryPrivacySchema = z.enum(MEMORY_PRIVACY_LEVELS);

export type MemoryPrivacy = z.infer<typeof memoryPrivacySchema>;

export const memoryFactSchema = z
  .object({
    id: z.string().min(1),
    content: z.string().min(1),
    scope: memoryScopeSchema,
    tags: z.array(z.string().min(1)).default([]),
    privacy: memoryPrivacySchema.default("private"),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    source: z.string().min(1).default("user"),
  })
  .strict();

export type MemoryFact = z.infer<typeof memoryFactSchema>;
