import { z } from 'zod';
import {
  AGENT_ENGINE_SCHEMA_VERSION,
  agentEngineResumeInputSchema,
  agentEngineStartInputSchema,
  agentModeSchema,
  agentRunBudgetSchema,
  createUserRequestInputSchema,
  planArtifactSchema,
  repositoryStateReferenceSchema,
} from '@mitii/v8';
import type {
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentMode,
  AgentRunBudget,
  PlanArtifact,
  RepositoryStateReference,
} from '@mitii/v8';

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

export const mitiiStartInputSchema = z
  .object({
    prompt: z.string().min(1),
    mode: agentModeSchema.optional(),
    sessionId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
    workspaceRoot: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    repositoryState: z
      .object({
        reference: repositoryStateReferenceSchema,
        readiness: z.enum(['ready', 'degraded', 'unavailable']).optional(),
      })
      .strict()
      .optional(),
    /**
     * Prior user/assistant turns for multi-turn continuity.
     * Engine compactConversation applies token budgets.
     */
    conversation: z.array(mitiiConversationMessageSchema).max(200).optional(),
    /**
     * Structured plan from a prior plan-mode turn (plan→agent handoff).
     * Injected as an approved plan; skips the in-run plan gate.
     */
    approvedPlan: planArtifactSchema.optional(),
    budget: agentRunBudgetSchema.optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    approvalMode: mitiiApprovalModeSchema.optional(),
    planApproval: z.enum(['policy', 'never']).optional(),
    dirtyPaths: z.array(z.string().min(1)).optional(),
    /**
     * Host-loaded project rules (AGENTS.md, .mitii/rules, MITTII.local.md).
     * Mapped to Agent Engine Prompt Construction `instructions.projectRules`.
     */
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
  })
  .strict();

export type MitiiStartInput = z.infer<typeof mitiiStartInputSchema>;

export const mitiiResumeInputSchema = agentEngineResumeInputSchema;
export type MitiiResumeInput = AgentEngineResumeInput;

export type { AgentMode, AgentRunBudget, RepositoryStateReference };
export type { PlanArtifact };

export interface MitiiStartDefaults {
  mode: AgentMode;
  sessionId: string;
  workspaceRoot?: string;
  workspaceId?: string;
}

export function toAgentEngineStartInput(
  input: MitiiStartInput,
  defaults: MitiiStartDefaults,
): AgentEngineStartInput {
  const parsed = mitiiStartInputSchema.parse(input);
  const request = createUserRequestInputSchema.parse({
    requestId: parsed.requestId,
    sessionId: parsed.sessionId ?? defaults.sessionId,
    mode: parsed.mode ?? defaults.mode,
    userMessage: parsed.prompt,
    workspace:
      parsed.workspaceId || defaults.workspaceId
        ? { workspaceId: parsed.workspaceId ?? defaults.workspaceId }
        : undefined,
  });

  return agentEngineStartInputSchema.parse({
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    request,
    workspaceRoot: parsed.workspaceRoot ?? defaults.workspaceRoot,
    repositoryState: parsed.repositoryState
      ? {
          reference: parsed.repositoryState.reference,
          readiness: parsed.repositoryState.readiness ?? 'ready',
        }
      : undefined,
    conversation: parsed.conversation?.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    approvedPlan: parsed.approvedPlan,
    budget: parsed.budget,
    model: parsed.model,
    temperature: parsed.temperature,
    stream: parsed.stream,
    approvalMode: parsed.approvalMode,
    planApproval: parsed.planApproval,
    dirtyPaths: parsed.dirtyPaths,
    instructions:
      parsed.projectRules && parsed.projectRules.length > 0
        ? {
            projectRules: parsed.projectRules.map((rule) => ({
              id: rule.id,
              content: rule.content,
              ...(rule.title ? { title: rule.title } : {}),
              priority: rule.priority ?? 100,
            })),
          }
        : undefined,
  });
}
