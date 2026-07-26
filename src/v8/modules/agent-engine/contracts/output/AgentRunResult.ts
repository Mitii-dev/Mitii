import { z } from "zod";

import {
  executionRouteSchema,
  planningDepthSchema,
} from "../../../decision-policy";
import { repositoryStateReferenceSchema } from "../../../repository-state";

import {
  AGENT_ENGINE_SCHEMA_VERSION,
  AGENT_REASON_CODES,
  AGENT_RUN_STATUSES,
  AGENT_SUSPENSION_KINDS,
} from "../../constants";

export const agentRunStatusSchema = z.enum(AGENT_RUN_STATUSES);
export const agentSuspensionKindSchema = z.enum(AGENT_SUSPENSION_KINDS);
export const agentReasonCodeSchema = z.enum(AGENT_REASON_CODES);

export const agentRunUsageSchema = z
  .object({
    modelCalls: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    loopIterations: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export type AgentRunUsage = z.infer<typeof agentRunUsageSchema>;

export const agentRunSuspensionSchema = z
  .object({
    kind: agentSuspensionKindSchema,
    rationale: z.string().min(1),
    clarificationPrompt: z.string().min(1).optional(),
  })
  .strict();

export type AgentRunSuspension = z.infer<typeof agentRunSuspensionSchema>;

export const agentRunResultSchema = z
  .object({
    schemaVersion: z.literal(AGENT_ENGINE_SCHEMA_VERSION),
    runId: z.string().min(1),
    requestId: z.string().min(1),
    status: agentRunStatusSchema,
    route: executionRouteSchema.optional(),
    planningDepth: planningDepthSchema.optional(),
    answer: z.string().optional(),
    suspension: agentRunSuspensionSchema.optional(),
    pinnedState: repositoryStateReferenceSchema.optional(),
    reasonCodes: z.array(agentReasonCodeSchema).min(1),
    warnings: z.array(z.string()),
    usage: agentRunUsageSchema,
    durationMs: z.number().int().nonnegative(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AgentRunResult = z.infer<typeof agentRunResultSchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentReasonCode = z.infer<typeof agentReasonCodeSchema>;
export type AgentSuspensionKind = z.infer<typeof agentSuspensionKindSchema>;
