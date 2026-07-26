import { z } from "zod";

import {
  MEMORY_COMMIT_STATUSES,
  MEMORY_OMISSION_REASONS,
  MEMORY_REASON_CODES,
  MEMORY_RETRIEVAL_STATUSES,
  MEMORY_SCHEMA_VERSION,
} from "../../constants";

export const memoryInstructionBlockSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    content: z.string().min(1),
    priority: z.number().int().nonnegative().default(100),
    provenance: z
      .object({
        memoryId: z.string().min(1),
        source: z.literal("memory"),
        scopeKind: z.enum(["user", "workspace", "project"]),
        score: z.number().min(0).max(1),
        privacy: z.enum(["private", "shareable"]),
        createdAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export type MemoryInstructionBlock = z.infer<
  typeof memoryInstructionBlockSchema
>;

export const memoryOmissionSchema = z
  .object({
    memoryId: z.string().min(1),
    reason: z.enum(MEMORY_OMISSION_REASONS),
    tokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export type MemoryOmission = z.infer<typeof memoryOmissionSchema>;

export const memoryRetrieveResultSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
    status: z.enum(MEMORY_RETRIEVAL_STATUSES),
    instructions: z.array(memoryInstructionBlockSchema),
    omissions: z.array(memoryOmissionSchema),
    usedTokens: z.number().int().nonnegative(),
    budgetTokens: z.number().int().positive(),
    warnings: z.array(z.string()),
    reasonCodes: z.array(z.enum(MEMORY_REASON_CODES)),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type MemoryRetrieveResult = z.infer<typeof memoryRetrieveResultSchema>;
export type MemoryReasonCode = (typeof MEMORY_REASON_CODES)[number];

export const memoryCommitResultSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
    status: z.enum(MEMORY_COMMIT_STATUSES),
    memoryId: z.string().min(1).optional(),
    expiresAt: z.string().datetime().optional(),
    warnings: z.array(z.string()),
    reasonCodes: z.array(z.enum(MEMORY_REASON_CODES)),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type MemoryCommitResult = z.infer<typeof memoryCommitResultSchema>;
