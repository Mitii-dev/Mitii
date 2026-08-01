import { z } from "zod";

import { MEMORY_SCHEMA_VERSION } from "../../constants";
import {
  DEFAULT_MAX_MEMORY_FACTS,
  DEFAULT_MEMORY_BUDGET_TOKENS,
} from "../../defaults";
import { memoryScopeSchema } from "../output/MemoryFact";

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
  })
  .strict();

export type MemoryCommitInput = z.infer<typeof memoryCommitInputSchema>;
