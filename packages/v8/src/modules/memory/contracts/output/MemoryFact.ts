import { z } from "zod";

import {
  MEMORY_FACT_TYPES,
  MEMORY_PRIVACY_LEVELS,
  MEMORY_SCOPES,
} from "../../constants";
import { DEFAULT_MEMORY_IMPORTANCE } from "../../defaults";

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

export const memoryFactTypeSchema = z.enum(MEMORY_FACT_TYPES);

export type MemoryFactType = z.infer<typeof memoryFactTypeSchema>;

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
    type: memoryFactTypeSchema.default("fact"),
    title: z.string().min(1).optional(),
    concepts: z.array(z.string().min(1)).default([]),
    files: z.array(z.string().min(1)).default([]),
    importance: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(DEFAULT_MEMORY_IMPORTANCE),
    sourceIds: z.array(z.string().min(1)).default([]),
    version: z.number().int().positive().default(1),
    isLatest: z.boolean().default(true),
    supersedes: z.array(z.string().min(1)).default([]),
    contentHash: z.string().min(1).optional(),
    accessCount: z.number().int().nonnegative().default(0),
    lastAccessedAt: z.string().datetime().optional(),
    accessLog: z.array(z.string().datetime()).max(20).default([]),
  })
  .strict();

export type MemoryFact = z.infer<typeof memoryFactSchema>;
export type MemoryFactDraft = z.input<typeof memoryFactSchema>;
