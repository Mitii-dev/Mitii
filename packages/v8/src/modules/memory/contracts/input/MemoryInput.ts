import { z } from "zod";

import { MEMORY_SCHEMA_VERSION } from "../../constants";
import {
  DEFAULT_MAX_MEMORY_FACTS,
  DEFAULT_MEMORY_BUDGET_TOKENS,
  DEFAULT_MEMORY_IMPORTANCE,
} from "../../defaults";
import {
  memoryFactTypeSchema,
  memoryScopeSchema,
} from "../output/MemoryFact";

export const memoryRetrieveInputSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
    query: z.string().min(1),
    scope: memoryScopeSchema,
    /** Caller identity for privacy filtering of private facts. */
    requesterUserId: z.string().min(1).optional(),
    budgetTokens: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MEMORY_BUDGET_TOKENS),
    maxFacts: z.number().int().positive().default(DEFAULT_MAX_MEMORY_FACTS),
    now: z.string().datetime().optional(),
    /** Workspace-relative file targets from Request Understanding. */
    fileTargets: z.array(z.string().min(1)).default([]),
    /** Extra concept tokens to union into the retrieve query. */
    concepts: z.array(z.string().min(1)).default([]),
    /** Optional run id recorded on access touch. */
    runId: z.string().min(1).optional(),
  })
  .strict();

export type MemoryRetrieveInput = z.input<typeof memoryRetrieveInputSchema>;
export type MemoryRetrieveParsedInput = z.infer<
  typeof memoryRetrieveInputSchema
>;

export const memoryCommitInputSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
    content: z.string().min(1),
    scope: memoryScopeSchema,
    tags: z.array(z.string().min(1)).default([]),
    privacy: z.enum(["private", "shareable"]).default("private"),
    source: z.string().min(1).default("user"),
    /** Explicit expiry; otherwise policy default retention applies. */
    expiresAt: z.string().datetime().optional(),
    now: z.string().datetime().optional(),
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
  })
  .strict();

export type MemoryCommitInput = z.input<typeof memoryCommitInputSchema>;
export type MemoryCommitParsedInput = z.infer<typeof memoryCommitInputSchema>;
