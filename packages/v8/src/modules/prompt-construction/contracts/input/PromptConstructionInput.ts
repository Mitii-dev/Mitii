import { z } from "zod";
import { memoryInstructionBlockSchema } from "../../../memory";

import { executionDecisionSchema } from "../../../decision-policy";
import {
  modelCapabilitiesSchema,
  modelMessageSchema,
  modelToolDefinitionSchema,
} from "../../../model-gateway";

import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
  PROMPT_TRUST_LEVELS,
} from "../../constants";

export const promptInstructionBlockSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    content: z.string().min(1),
    priority: z.number().int().nonnegative().default(100),
    memoryProvenance: memoryInstructionBlockSchema.shape.provenance.optional(),
  })
  .strict();

export type PromptInstructionBlock = z.infer<
  typeof promptInstructionBlockSchema
>;

export const promptExtraFragmentSectionSchema = z.enum([
  "system",
  "rules",
  "skills",
  "memory",
  "plan",
  "environment",
]);

/**
 * Serializable typed injection for Prompt Construction (INJ-O).
 * Mapped to ContextualFragment adapters inside buildSystemInstructions.
 */
export const promptExtraFragmentSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["system", "developer", "user"]).default("system"),
    contentKind: z.string().min(1),
    section: promptExtraFragmentSectionSchema,
    trust: z.enum(PROMPT_TRUST_LEVELS).default("trusted_instruction"),
    content: z.string().min(1),
    maxTokens: z.number().int().positive().optional(),
    marked: z.boolean().optional(),
    separateMessage: z.boolean().optional(),
    priority: z.number().int().nonnegative().default(100),
  })
  .strict();

export type PromptExtraFragment = z.infer<typeof promptExtraFragmentSchema>;

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
    /**
     * Host IDE / session pulse (visible files, tabs, terminals, git).
     * Injected each turn; omitted when the host supplies none.
     */
    environment: z.array(promptInstructionBlockSchema).optional(),
  })
  .strict();

export type PromptInstructions = z.infer<typeof promptInstructionsSchema>;

export const promptImageAttachmentSchema = z
  .object({
    mimeType: z.string().min(1),
    data: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .strict();

export type PromptImageAttachment = z.infer<typeof promptImageAttachmentSchema>;

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
    attachments: z.array(promptImageAttachmentSchema).optional(),
    conversation: z.array(modelMessageSchema).default([]),
    repositoryContext: promptRepositoryContextSchema.optional(),
    instructions: promptInstructionsSchema.optional(),
    /**
     * Optional typed injections beyond built-in rules/skills/memory/env.
     * Assembled under the shared system budget with hard per-fragment caps.
     */
    extraFragments: z.array(promptExtraFragmentSchema).optional(),
    /**
     * Serialized trusted plan block from Planning (already wrapped / instruction-safe).
     * Optional — omitted when planningDepth is none or planning was skipped.
     */
    planText: z.string().min(1).max(20_000).optional(),
    /**
     * Trusted DecisionBrief block (already formatted). Advisory only.
     */
    decisionBriefText: z.string().min(1).max(8_000).optional(),
    tools: z.array(modelToolDefinitionSchema).optional(),
    capabilities: modelCapabilitiesSchema,
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    /** Optional override for output reserve; otherwise policy derives it. */
    outputReserveTokens: z.number().int().positive().optional(),
    /** Window-reserved plan slice; used for metering when plan text is present. */
    planBudgetTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export type PromptConstructionInput = z.infer<
  typeof promptConstructionInputSchema
>;
