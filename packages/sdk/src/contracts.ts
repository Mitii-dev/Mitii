import { z } from 'zod';
import {
  AGENT_ENGINE_SCHEMA_VERSION,
  AGENT_LOG_VERBOSITIES,
  agentEngineResumeInputSchema,
  agentEngineStartInputSchema,
  agentModeSchema,
  agentRunBudgetSchema,
  createUserRequestInputSchema,
  explorationDepthSchema,
  planArtifactSchema,
  planStrategyDecisionSchema,
  repositoryStateReferenceSchema,
  taskListSchema,
  WINDOW_BUDGET_EFFORTS,
  windowBudgetPolicyOverridesSchema,
  agentEngineThresholdsOverridesSchema,
} from '@mitii/v8';
import type {
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentMode,
  AgentRunBudget,
  ExplorationDepth,
  PlanArtifact,
  PlanStrategyDecision,
  RepositoryStateReference,
  TaskList,
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
    /** Strategy for a host-carried approved plan. */
    approvedPlanStrategy: planStrategyDecisionSchema.optional(),
    /**
     * Live working checklist from a prior Agent/Plan turn.
     * Engine does not stamp remaining items done on run completion.
     */
    taskList: taskListSchema.optional(),
    budget: agentRunBudgetSchema.optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    approvalMode: mitiiApprovalModeSchema.optional(),
    planApproval: z.enum(['policy', 'never']).optional(),
    dirtyPaths: z.array(z.string().min(1)).optional(),
    /**
     * How hard Engine should look before drafting a plan. "auto" defers to
     * strategy rules; "quick" skips discovery even for wide-scope asks.
     */
    explorationDepth: explorationDepthSchema.optional(),
    /**
     * Optional host overrides for window-proportional token allocation.
     * When omitted, Window Budget defaults apply.
     */
    windowBudget: z
      .object({
        policy: windowBudgetPolicyOverridesSchema.optional(),
        effort: z.enum(WINDOW_BUDGET_EFFORTS).optional(),
      })
      .strict()
      .optional(),
    /**
     * Optional host overrides for Agent Engine loop/stall thresholds.
     * When omitted, shipped working standards apply.
     */
    loopPolicy: z
      .object({
        thresholds: agentEngineThresholdsOverridesSchema.optional(),
      })
      .strict()
      .optional(),
    /**
     * Developer-facing run-log detail level. Defaults to "verbose" so bugs
     * are discoverable; hosts can turn it down when log volume matters more.
     */
    logVerbosity: z.enum(AGENT_LOG_VERBOSITIES).optional(),
    /**
     * Host-pinned workspace paths (@mentions). Mapped to intake
     * referencedArtifacts so understanding/context can prefer them.
     */
    pinnedPaths: z.array(z.string().min(1)).max(32).optional(),
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
export type { PlanArtifact, PlanStrategyDecision, TaskList, ExplorationDepth };

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
  const pinnedArtifacts = (parsed.pinnedPaths ?? [])
    .map((path) => path.replace(/\\/g, '/').replace(/^@/, '').trim())
    .filter((path) => path.length > 0)
    .slice(0, 32)
    .map((path) => {
      const normalized = path.replace(/\/+$/, '') || path;
      return {
        name: normalized,
        path: normalized,
        kind: inferPinnedArtifactKind(path),
      };
    });
  const request = createUserRequestInputSchema.parse({
    requestId: parsed.requestId,
    sessionId: parsed.sessionId ?? defaults.sessionId,
    mode: parsed.mode ?? defaults.mode,
    userMessage: parsed.prompt,
    ...(pinnedArtifacts.length > 0
      ? { referencedArtifacts: pinnedArtifacts }
      : {}),
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
    approvedPlanStrategy: parsed.approvedPlanStrategy,
    taskList: parsed.taskList,
    budget: parsed.budget,
    model: parsed.model,
    temperature: parsed.temperature,
    stream: parsed.stream,
    approvalMode: parsed.approvalMode,
    planApproval: parsed.planApproval,
    dirtyPaths: parsed.dirtyPaths,
    explorationDepth: parsed.explorationDepth,
    windowBudget: parsed.windowBudget,
    loopPolicy: parsed.loopPolicy,
    logVerbosity: parsed.logVerbosity,
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

/**
 * Infer artifact kind for host-pinned paths without a workspace walk.
 * Trailing slash ⇒ folder; known extensionless filenames and common
 * file extensions ⇒ file. Dotted folder names (packages.legacy) stay folders.
 */
function inferPinnedArtifactKind(path: string): 'file' | 'folder' {
  const normalized = path.replace(/\\/g, '/').trim();
  if (normalized.endsWith('/')) {
    return 'folder';
  }
  const base = normalized.split('/').pop() ?? normalized;
  if (
    /^(?:Makefile|Dockerfile|Gemfile|Procfile|Rakefile|Podfile|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|Pipfile|poetry\.lock)$/i.test(
      base,
    )
  ) {
    return 'file';
  }
  // Dotfiles (.env, .gitignore).
  if (/^\.[A-Za-z0-9][\w.-]*$/.test(base)) {
    return 'file';
  }
  // Common multi-language source / config extensions (not "any dot").
  if (
    /\.(?:[cm]?[jt]sx?|mjs|cjs|py|go|rs|java|kt|kts|swift|rb|php|cs|cpp|cxx|cc|h|hpp|hh|md|mdx|json|ya?ml|toml|xml|html?|css|scss|sass|less|sql|sh|bash|zsh|ps1|bat|cmd|env|lock|txt|csv|svg|png|jpe?g|webp|gif|wasm|proto|graphql|gql|dart|lua|r|jl|ex|exs|erl|hs|scala|clj|cljs|fs|fsx|vb|pl|pm|raku|zig|nim|v|d|f90|f95|asm|s|ipynb|vue|svelte|astro|tf|hcl|bicep|gradle|groovy|cmake|makefile)$/i.test(
      base,
    )
  ) {
    return 'file';
  }
  return 'folder';
}
