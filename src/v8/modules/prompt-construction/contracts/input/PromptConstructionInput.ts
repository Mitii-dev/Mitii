import { z } from "zod";

import { executionDecisionSchema } from "../../../decision-policy";
import {
  modelCapabilitiesSchema,
  modelMessageSchema,
  modelToolDefinitionSchema,
} from "../../../model-gateway";

import { PROMPT_CONSTRUCTION_SCHEMA_VERSION } from "../../constants";

export const promptInstructionBlockSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    content: z.string().min(1),
    priority: z.number().int().nonnegative().default(100),
  })
  .strict();

export type PromptInstructionBlock = z.infer<
  typeof promptInstructionBlockSchema
>;

export const promptRepositoryBlockSchema = z
  .object({
    id: z.string().min(1),
    relativePath: z.string().min(1),
    content: z.string().min(1),
    tokenEstimate: z.number().int().positive().optional(),
    truncated: z.boolean().default(false),
    omittedCharacters: z.number().int().nonnegative().default(0),
    priority: z.number().int().nonnegative().default(100),
    score: z.number().min(0).max(1).optional(),
    selectionKey: z.string().min(1).optional(),
    lineRanges: z
      .array(
        z
          .object({
            startLine: z.number().int().positive(),
            endLine: z.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type PromptRepositoryBlock = z.infer<typeof promptRepositoryBlockSchema>;

export const promptRepositoryContextSchema = z
  .object({
    stateToken: z.string().min(1),
    blocks: z.array(promptRepositoryBlockSchema),
    dropped: z
      .array(
        z
          .object({
            relativePath: z.string().min(1),
            cause: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type PromptRepositoryContext = z.infer<
  typeof promptRepositoryContextSchema
>;

export const promptInstructionsSchema = z
  .object({
    projectRules: z.array(promptInstructionBlockSchema).optional(),
    skills: z.array(promptInstructionBlockSchema).optional(),
    memory: z.array(promptInstructionBlockSchema).optional(),
  })
  .strict();

export type PromptInstructions = z.infer<typeof promptInstructionsSchema>;

/**
 * Boundary input for Prompt Construction.
 *
 * Repository context is accepted as an assembly-facing slice (blocks +
 * provenance fields) so index/provider internals never enter the prompt path.
 * Tool JSON schemas are supplied by the Engine after grant filtering.
 */
export const promptConstructionInputSchema = z
  .object({
    schemaVersion: z.literal(PROMPT_CONSTRUCTION_SCHEMA_VERSION),
    decision: executionDecisionSchema,
    userMessage: z.string().min(1),
    conversation: z.array(modelMessageSchema).default([]),
    repositoryContext: promptRepositoryContextSchema.optional(),
    instructions: promptInstructionsSchema.optional(),
    tools: z.array(modelToolDefinitionSchema).optional(),
    capabilities: modelCapabilitiesSchema,
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    /** Optional override for output reserve; otherwise policy derives it. */
    outputReserveTokens: z.number().int().positive().optional(),
  })
  .strict();

export type PromptConstructionInput = z.infer<
  typeof promptConstructionInputSchema
>;
