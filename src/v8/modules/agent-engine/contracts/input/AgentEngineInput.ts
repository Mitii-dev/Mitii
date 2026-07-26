import { z } from "zod";

import { createUserRequestInputSchema } from "../../../request-intake";
import { repositoryStateCapabilitySummarySchema } from "../../../decision-policy";
import {
  modelMessageSchema,
  modelToolDefinitionSchema,
} from "../../../model-gateway";
import { promptInstructionsSchema } from "../../../prompt-construction";

import { AGENT_ENGINE_SCHEMA_VERSION } from "../../constants";
import {
  DEFAULT_MAX_LOOP_ITERATIONS,
  DEFAULT_MAX_MODEL_CALLS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_WALL_TIME_MS,
} from "../../defaults";

export const agentRunBudgetSchema = z
  .object({
    maxModelCalls: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_MODEL_CALLS),
    maxToolCalls: z.number().int().positive().default(DEFAULT_MAX_TOOL_CALLS),
    maxLoopIterations: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_LOOP_ITERATIONS),
    maxWallTimeMs: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_WALL_TIME_MS),
  })
  .strict();

export type AgentRunBudget = z.infer<typeof agentRunBudgetSchema>;

/**
 * Boundary input for starting a Phase 7 read-only agent run.
 *
 * Hosts supply the raw request plus optional pinned/known repository state.
 * Engine pins state when Decision Policy requires repository context.
 */
export const agentEngineStartInputSchema = z
  .object({
    schemaVersion: z.literal(AGENT_ENGINE_SCHEMA_VERSION),
    request: createUserRequestInputSchema,
    /** Absolute workspace root required when tools may execute. */
    workspaceRoot: z.string().min(1).optional(),
    repositoryState: repositoryStateCapabilitySummarySchema.optional(),
    conversation: z.array(modelMessageSchema).default([]),
    instructions: promptInstructionsSchema.optional(),
    /** Optional override; otherwise Engine uses default read-only definitions. */
    tools: z.array(modelToolDefinitionSchema).optional(),
    budget: agentRunBudgetSchema.optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
  })
  .strict();

export type AgentEngineStartInput = z.infer<typeof agentEngineStartInputSchema>;
