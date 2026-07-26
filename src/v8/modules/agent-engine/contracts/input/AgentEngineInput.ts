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
 * Boundary input for starting an agent run.
 *
 * Hosts supply the raw request plus optional pinned/known repository state.
 * Engine pins state when Decision Policy requires repository context.
 * Optional dirtyPaths list user-dirty files for overlap checks.
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
    /** Optional override; otherwise Engine uses default tool definitions. */
    tools: z.array(modelToolDefinitionSchema).optional(),
    budget: agentRunBudgetSchema.optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    /**
     * Workspace-relative paths dirty before the run (user edits).
     * Used for dirty-overlap rejection on mutation tools.
     */
    dirtyPaths: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type AgentEngineStartInput = z.infer<typeof agentEngineStartInputSchema>;

/**
 * Resume a suspended run after clarification or approval.
 * Resume continues from the persisted checkpoint and does not replay
 * completed tool callIds.
 */
export const agentEngineResumeInputSchema = z
  .object({
    schemaVersion: z.literal(AGENT_ENGINE_SCHEMA_VERSION),
    runId: z.string().min(1),
    approval: z
      .object({
        approvalId: z.string().min(1),
        decision: z.enum(["approved", "denied"]),
      })
      .strict()
      .optional(),
    clarificationAnswer: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.approval && !value.clarificationAnswer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resume requires approval or clarificationAnswer.",
      });
    }
  });

export type AgentEngineResumeInput = z.infer<
  typeof agentEngineResumeInputSchema
>;
