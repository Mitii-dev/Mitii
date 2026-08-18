import { z } from "zod";

import {
  executionRouteSchema,
  planningDepthSchema,
} from "../../../../modules/decision-policy";
import {
  planArtifactSchema,
  planStrategyDecisionSchema,
} from "../../../../modules/planning";
import { taskListSchema } from "../../../../modules/task-list";
import { repositoryStateReferenceSchema } from "../../../../modules/repository-state";
import {
  repoBuildStateSchema,
  verificationRecordSchema,
} from "../../../../modules/verification";
import { runEvidenceSchema } from "./RunEvidence";

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
    cacheHitTokens: z.number().int().nonnegative().optional(),
    cacheMissTokens: z.number().int().nonnegative().optional(),
    fileReadCalls: z.number().int().nonnegative().optional(),
    uniqueFilePathsTouched: z.number().int().nonnegative().optional(),
  })
  .strict();

export type AgentRunUsage = z.infer<typeof agentRunUsageSchema>;

export const clarificationOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1).optional(),
  })
  .strict();

export const agentRunSuspensionSchema = z
  .object({
    kind: agentSuspensionKindSchema,
    rationale: z.string().min(1),
    /** Short user-facing question — never the full composed host prompt. */
    clarificationPrompt: z.string().min(1).max(2_000).optional(),
    clarificationOptions: z.array(clarificationOptionSchema).max(8).optional(),
    /** Structured plan awaiting approval/edit when kind is plan_approval_required. */
    plan: planArtifactSchema.optional(),
    approval: z
      .object({
        approvalId: z.string().min(1),
        fingerprint: z.string().min(1),
        toolName: z.string().min(1),
        callId: z.string().min(1),
        paths: z.array(z.string()).optional(),
        arguments: z.unknown().optional(),
      })
      .strict()
      .optional(),
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
    /** Structured plan when planningDepth produced an artifact. */
    plan: planArtifactSchema.optional(),
    /** How the plan should be followed after draft, approval, or host carry. */
    planStrategy: planStrategyDecisionSchema.optional(),
    /** Compact live checklist. Absent in ask mode. Never auto-completed. */
    taskList: taskListSchema.optional(),
    repoBuildStateBefore: repoBuildStateSchema.optional(),
    repoBuildStateAfter: repoBuildStateSchema.optional(),
    verificationRecord: verificationRecordSchema.optional(),
    evidence: runEvidenceSchema.optional(),
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
