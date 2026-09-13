import { z } from 'zod';
import {
  AGENT_LOG_VERBOSITIES,
  agentEngineResumeInputSchema,
  agentEngineRestoreInputSchema,
  agentModeSchema,
  agentRunBudgetSchema,
  explorationDepthSchema,
  planArtifactSchema,
  planStrategyDecisionSchema,
  repositoryStateReferenceSchema,
  taskListSchema,
  USER_REQUEST_ORIGINS,
  WINDOW_BUDGET_EFFORTS,
  windowBudgetPolicyOverridesSchema,
  agentEngineThresholdsOverridesSchema,
  MAX_REQUIRED_SKILLS,
  MAX_REQUIRED_MCP_SERVERS,
  REQUEST_ENVELOPE_LIMITS,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@mitii/v8';
import type {
  AgentEngineResumeInput,
  AgentEngineRestoreInput,
  AgentEngineRestoreResult,
  AgentMode,
  AgentRunBudget,
  ExplorationDepth,
  PlanArtifact,
  PlanStrategyDecision,
  RepositoryStateReference,
  RestorePointSummary,
  TaskList,
  UserRequestOrigin,
} from '@mitii/v8';

import { mitiiAutonomyPresetSchema, type MitiiAutonomyPreset } from './autonomy.js';

export {
  toAgentEngineStartInput,
  type MitiiStartDefaults,
  inferPinnedArtifactKind,
} from './toAgentEngineStartInput.js';

/**
 * Host-facing start input. Mapped onto V8 AgentEngineStartInput.
 * Secrets must never appear here.
 */
const mitiiApprovalModeSchema = z.enum([
  'never',
  'when_required',
  'every_mutation',
]);

/**
 * Prior chat turns the host wants carried into the model.
 * Host-facing roles only — system/tool history is owned by the engine loop.
 */
export const mitiiConversationMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1),
  })
  .strict();

export type MitiiConversationMessage = z.infer<
  typeof mitiiConversationMessageSchema
>;

/** Host-facing image attachment. Mapped onto V8 request-envelope attachments. */
export const mitiiImageAttachmentSchema = z
  .object({
    mimeType: z.enum(SUPPORTED_IMAGE_MIME_TYPES),
    data: z
      .string()
      .min(1)
      .max(REQUEST_ENVELOPE_LIMITS.MAXIMUM_ATTACHMENT_DATA_CHARACTERS),
    name: z
      .string()
      .min(1)
      .max(REQUEST_ENVELOPE_LIMITS.MAXIMUM_ATTACHMENT_NAME_CHARACTERS)
      .optional(),
  })
  .strict();

export type MitiiImageAttachment = z.infer<typeof mitiiImageAttachmentSchema>;

export const mitiiStartInputSchema = z
  .object({
    prompt: z.string().min(1),
    mode: agentModeSchema.optional(),
    sessionId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
    origin: z.enum(USER_REQUEST_ORIGINS).optional(),
    autonomyPreset: mitiiAutonomyPresetSchema.optional(),
    correlation: z
      .object({
        traceId: z.string().min(1).max(500).optional(),
        clientRequestId: z.string().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
    workspaceRoot: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    repositoryState: z
      .object({
        reference: repositoryStateReferenceSchema,
        readiness: z.enum(['ready', 'degraded', 'unavailable']).optional(),
      })
      .strict()
      .optional(),
    conversation: z.array(mitiiConversationMessageSchema).max(200).optional(),
    approvedPlan: planArtifactSchema.optional(),
    approvedPlanStrategy: planStrategyDecisionSchema.optional(),
    taskList: taskListSchema.optional(),
    budget: agentRunBudgetSchema.optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    approvalMode: mitiiApprovalModeSchema.optional(),
    planApproval: z.enum(['policy', 'never']).optional(),
    steering: z
      .object({
        understandingBallotV2: z.boolean().optional(),
        policyFactsFirst: z.boolean().optional(),
        decisionBrief: z.boolean().optional(),
        criticMode: z.enum(['off', 'shadow', 'enforce']).optional(),
      })
      .strict()
      .optional(),
    userSafetyRules: z
      .object({
        enabled: z.boolean().default(false),
        denyTools: z.array(z.string().min(1)).default([]),
        denyCommandPrefixes: z.array(z.string().min(1)).default([]),
        allowCommandPrefixes: z.array(z.string().min(1)).optional(),
        denyPathScopes: z.array(z.string().min(1)).default([]),
        denyNetworkHosts: z.array(z.string().min(1)).default([]),
        approvalCeiling: mitiiApprovalModeSchema.optional(),
      })
      .strict()
      .optional(),
    dirtyPaths: z.array(z.string().min(1)).optional(),
    explorationDepth: explorationDepthSchema.optional(),
    windowBudget: z
      .object({
        policy: windowBudgetPolicyOverridesSchema.optional(),
        effort: z.enum(WINDOW_BUDGET_EFFORTS).optional(),
        maximumOutputTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    loopPolicy: z
      .object({
        thresholds: agentEngineThresholdsOverridesSchema.optional(),
      })
      .strict()
      .optional(),
    logVerbosity: z.enum(AGENT_LOG_VERBOSITIES).optional(),
    pinnedPaths: z.array(z.string().min(1)).max(32).optional(),
    projectRules: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1).optional(),
            content: z.string().min(1),
            priority: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    requiredSkillIds: z
      .array(z.string().min(1).max(64))
      .max(MAX_REQUIRED_SKILLS)
      .optional(),
    requiredMcpServerIds: z
      .array(z.string().min(1).max(64))
      .max(MAX_REQUIRED_MCP_SERVERS)
      .optional(),
    attachments: z
      .array(mitiiImageAttachmentSchema)
      .max(REQUEST_ENVELOPE_LIMITS.MAXIMUM_ATTACHMENTS)
      .optional(),
  })
  .strict();

export type MitiiStartInput = z.infer<typeof mitiiStartInputSchema>;

export const mitiiResumeInputSchema = agentEngineResumeInputSchema;
export type MitiiResumeInput = AgentEngineResumeInput;

export const mitiiRestoreInputSchema = agentEngineRestoreInputSchema;
export type MitiiRestoreInput = AgentEngineRestoreInput;
export type MitiiRestoreResult = AgentEngineRestoreResult;
export type { RestorePointSummary };

export type { AgentMode, AgentRunBudget, RepositoryStateReference };
export type { PlanArtifact, PlanStrategyDecision, TaskList, ExplorationDepth };
export type { MitiiAutonomyPreset, UserRequestOrigin };
export {
  MITII_AUTONOMY_PRESETS,
  mitiiAutonomyPresetSchema,
  resolveAutonomyPreset,
} from './autonomy.js';
