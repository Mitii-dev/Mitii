import {
  AGENT_ENGINE_SCHEMA_VERSION,
  agentEngineStartInputSchema,
  createUserRequestInputSchema,
  mergeRequiredMcpServerIds,
  mergeRequiredSkillIds,
  parseRequiredMcpMentions,
  parseRequiredSkillMentions,
  type AgentEngineStartInput,
  type AgentMode,
} from '@mitii/v8';

import { resolveAutonomyPreset } from './autonomy.js';
import {
  mitiiStartInputSchema,
  type MitiiStartInput,
} from './contracts.js';

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
  const autonomy = parsed.autonomyPreset
    ? resolveAutonomyPreset(parsed.autonomyPreset)
    : undefined;
  const mode = parsed.mode ?? autonomy?.mode ?? defaults.mode;
  const approvalMode = parsed.approvalMode ?? autonomy?.approvalMode;
  const planApproval = parsed.planApproval ?? autonomy?.planApproval;
  const origin = parsed.origin ?? 'user';

  const parsedMentions = parseRequiredSkillMentions(parsed.prompt);
  const requiredSkillIds = mergeRequiredSkillIds(
    parsed.requiredSkillIds,
    parsedMentions.requiredSkillIds,
  );
  const parsedMcpMentions = parseRequiredMcpMentions(
    parsedMentions.cleanedMessage,
  );
  const requiredMcpServerIds = mergeRequiredMcpServerIds(
    parsed.requiredMcpServerIds,
    parsedMcpMentions.requiredMcpServerIds,
  );
  const userMessage =
    parsedMcpMentions.cleanedMessage.length > 0
      ? parsedMcpMentions.cleanedMessage
      : parsedMentions.cleanedMessage.length > 0
        ? parsedMentions.cleanedMessage
        : parsed.prompt;

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
    mode,
    origin,
    userMessage,
    ...(pinnedArtifacts.length > 0
      ? { referencedArtifacts: pinnedArtifacts }
      : {}),
    ...(parsed.attachments && parsed.attachments.length > 0
      ? { attachments: parsed.attachments }
      : {}),
    workspace:
      parsed.workspaceId || defaults.workspaceId
        ? { workspaceId: parsed.workspaceId ?? defaults.workspaceId }
        : undefined,
    ...(parsed.correlation
      ? {
          correlation: {
            ...(parsed.correlation.traceId
              ? { traceId: parsed.correlation.traceId }
              : {}),
            ...(parsed.correlation.clientRequestId
              ? { clientRequestId: parsed.correlation.clientRequestId }
              : {}),
          },
        }
      : {}),
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
    approvalMode,
    planApproval,
    steering: parsed.steering,
    userSafetyRules: parsed.userSafetyRules,
    dirtyPaths: parsed.dirtyPaths,
    explorationDepth: parsed.explorationDepth,
    windowBudget: parsed.windowBudget,
    loopPolicy: parsed.loopPolicy,
    logVerbosity: parsed.logVerbosity,
    requiredSkillIds,
    requiredMcpServerIds,
    instructions: buildStartInstructions(parsed),
  });
}

function buildStartInstructions(
  parsed: MitiiStartInput,
): AgentEngineStartInput['instructions'] {
  const hasProjectRules =
    parsed.projectRules !== undefined && parsed.projectRules.length > 0;
  const hasEnvironment =
    parsed.environment !== undefined && parsed.environment.length > 0;
  if (!hasProjectRules && !hasEnvironment) {
    return undefined;
  }
  return {
    ...(hasProjectRules
      ? {
          projectRules: parsed.projectRules!.map((rule) => ({
            id: rule.id,
            content: rule.content,
            ...(rule.title ? { title: rule.title } : {}),
            priority: rule.priority ?? 100,
          })),
        }
      : {}),
    ...(hasEnvironment
      ? {
          environment: parsed.environment!.map((block) => ({
            id: block.id,
            content: block.content,
            ...(block.title ? { title: block.title } : {}),
            priority: block.priority ?? 100,
          })),
        }
      : {}),
  };
}

/**
 * Infer artifact kind for host-pinned paths without a workspace walk.
 */
export function inferPinnedArtifactKind(path: string): 'file' | 'folder' {
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
  if (/^\.[A-Za-z0-9][\w.-]*$/.test(base)) {
    return 'file';
  }
  if (
    /\.(?:[cm]?[jt]sx?|mjs|cjs|py|go|rs|java|kt|kts|swift|rb|php|cs|cpp|cxx|cc|h|hpp|hh|md|mdx|json|ya?ml|toml|xml|html?|css|scss|sass|less|sql|sh|bash|zsh|ps1|bat|cmd|env|lock|txt|csv|svg|png|jpe?g|webp|gif|wasm|proto|graphql|gql|dart|lua|r|jl|ex|exs|erl|hs|scala|clj|cljs|fs|fsx|vb|pl|pm|raku|zig|nim|v|d|f90|f95|asm|s|ipynb|vue|svelte|astro|tf|hcl|bicep|gradle|groovy|cmake|makefile)$/i.test(
      base,
    )
  ) {
    return 'file';
  }
  return 'folder';
}
