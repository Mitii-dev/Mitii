import { z } from "zod";

import { executionRouteSchema } from "../../../../modules/decision-policy";
import { repositoryStateReferenceSchema } from "../../../../modules/repository-state";

import {
  AGENT_ACTIVE_STAGES,
  AGENT_EVENT_TYPES,
  AGENT_REASON_CODES,
  AGENT_RUN_STATUSES,
  AGENT_SUSPENSION_KINDS,
} from "../../constants";
import { agentRunResultSchema } from "./AgentRunResult";

export const agentActiveStageSchema = z.enum(AGENT_ACTIVE_STAGES);
export const agentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);

/**
 * Structured run events. Never include secrets, full prompts, or raw tool
 * payloads — only safe metadata suitable for UI reconstruction.
 */
export const runEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stage_started"),
      runId: z.string().min(1),
      stage: agentActiveStageSchema,
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("stage_completed"),
      runId: z.string().min(1),
      stage: agentActiveStageSchema,
      at: z.string().datetime(),
      reasonCodes: z.array(z.enum(AGENT_REASON_CODES)).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("decision_made"),
      runId: z.string().min(1),
      route: executionRouteSchema,
      runDisposition: z.enum(["continue", "clarification_required"]),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("state_pinned"),
      runId: z.string().min(1),
      state: repositoryStateReferenceSchema,
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("skills_ready"),
      runId: z.string().min(1),
      selectedCount: z.number().int().nonnegative(),
      omittedCount: z.number().int().nonnegative(),
      status: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("memory_ready"),
      runId: z.string().min(1),
      selectedCount: z.number().int().nonnegative(),
      omittedCount: z.number().int().nonnegative(),
      status: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("context_ready"),
      runId: z.string().min(1),
      stateToken: z.string().min(1),
      blockCount: z.number().int().nonnegative(),
      status: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("model_delta"),
      runId: z.string().min(1),
      kind: z.enum(["content", "reasoning", "tool_call"]),
      /** Safe preview only — truncated content fragment. */
      preview: z.string().max(500).optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_started"),
      runId: z.string().min(1),
      callId: z.string().min(1),
      toolName: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_completed"),
      runId: z.string().min(1),
      callId: z.string().min(1),
      toolName: z.string().min(1),
      status: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("suspended"),
      runId: z.string().min(1),
      kind: z.enum(AGENT_SUSPENSION_KINDS),
      rationale: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("warning"),
      runId: z.string().min(1),
      message: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("terminal"),
      runId: z.string().min(1),
      status: z.enum(AGENT_RUN_STATUSES),
      result: agentRunResultSchema,
      at: z.string().datetime(),
    })
    .strict(),
]);

export type RunEvent = z.infer<typeof runEventSchema>;
export type AgentActiveStage = z.infer<typeof agentActiveStageSchema>;
