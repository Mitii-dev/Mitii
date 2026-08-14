import {
  InMemoryRepositoryStateStore,
  NodeNetworkAdapter,
  NodeGitAdapter,
  NodeProcessAdapter,
  NodeWorkspaceFileSystemAdapter,
  RepositoryStatePipeline,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceFileSystemManifestReader,
  createMitiiClient,
  type CreateMitiiClientOptions,
  type MitiiClient,
} from '@mitii/sdk';
import {
  createFileSystemSkillsCatalog,
  createHostCodeNavigationPort,
  createHostLlmPorts,
  createHostRepositoryGraphPort,
  createOptionalSearchPort,
  createWorkspaceCheckpointStore,
  createWorkspaceMemoryStore,
  getProviderPreset,
  inferHostProviderType,
  isHostProviderType,
  resolveProviderApiKey,
} from '@mitii/host';
import type { LlmPort, ModelCapabilities, ModelEvent, ModelRequest } from '@mitii/v8';

import { loadMitiiHostConfig, type MitiiHostConfig } from './config.js';
import { createHostRepositoryContext } from './repositoryContextHost.js';
import { resolveCliSemanticIndexSettings } from './semanticIndex.js';

/**
 * Deterministic understanding port for local smoke when no provider key is set.
 */
export class LocalUnderstandingLlmPort implements LlmPort {
  readonly id = 'cli-local-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'cli/local-understanding',
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield {
      type: 'content_delta',
      content: JSON.stringify({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.95,
        alternatives: [],
        needsClarification: false,
        reason: 'CLI local understanding (no remote provider).',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

export interface ResolveCliPortsOptions {
  forceEcho?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  config?: MitiiHostConfig;
}

export interface ResolvedCliPorts {
  understandingLlm: LlmPort;
  runLlm: LlmPort;
  providerLabel: string;
  workspaceId: string;
  defaultMode: 'ask' | 'plan' | 'agent';
}

export function resolveCliPorts(
  options: ResolveCliPortsOptions = {},
): ResolvedCliPorts {
  const env = options.env ?? process.env;
  const config =
    options.config ?? loadMitiiHostConfig(options.cwd ?? process.cwd());
  const workspaceId = config.workspaceId ?? 'cli_workspace';
  const defaultMode = config.defaultMode ?? 'ask';
  const forceEcho =
    options.forceEcho === true ||
    env.MITII_FORCE_ECHO === '1' ||
    config.provider === 'echo';

  const type =
    (env.MITII_PROVIDER && isHostProviderType(env.MITII_PROVIDER)
      ? env.MITII_PROVIDER
      : undefined) ??
    config.provider ??
    inferHostProviderType(env) ??
    'echo';
  const presetId =
    env.MITII_PROVIDER_PRESET ??
    config.providerPreset ??
    type;
  const preset = getProviderPreset(presetId);
  const model =
    env.MITII_MODEL ??
    config.model ??
    preset?.model ??
    'gpt-4o-mini';
  const baseUrl = env.MITII_BASE_URL ?? config.baseUrl ?? preset?.baseUrl;
  const apiKey = resolveProviderApiKey({ type, env });

  if (forceEcho || type === 'echo') {
    return {
      understandingLlm: new LocalUnderstandingLlmPort(),
      runLlm: createHostLlmPorts({ type: 'echo', model: 'echo' }).runLlm,
      providerLabel: 'echo',
      workspaceId,
      defaultMode,
    };
  }

  const ports = createHostLlmPorts({
    type,
    preset: presetId,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
  return {
    understandingLlm: ports.understandingLlm,
    runLlm: ports.runLlm,
    providerLabel: ports.providerLabel,
    workspaceId,
    defaultMode,
  };
}

export function createCliClient(options: {
  cwd: string;
  forceEcho?: boolean;
  env?: NodeJS.ProcessEnv;
  clientOverrides?: Partial<CreateMitiiClientOptions>;
}): { client: MitiiClient; ports: ResolvedCliPorts } {
  const ports = resolveCliPorts({
    forceEcho: options.forceEcho,
    env: options.env,
    cwd: options.cwd,
  });
  const env = options.env ?? process.env;
  const fileSystem = new NodeWorkspaceFileSystemAdapter();
  const search = createOptionalSearchPort(env);
  const git = new NodeGitAdapter();
  const tools = new ToolRuntimePipeline({
    fileSystem,
    process: new NodeProcessAdapter(),
    network: new NodeNetworkAdapter(),
    git,
    codeNavigation: createHostCodeNavigationPort({
      workspaceRoot: options.cwd,
    }),
    repoGraphs: createHostRepositoryGraphPort({
      workspaceRoot: options.cwd,
    }),
    ...(search ? { search } : {}),
  });
  const verification = new VerificationPipeline({
    tools,
    manifests: new WorkspaceFileSystemManifestReader({
      fileSystem,
      workspaceRoot: options.cwd,
    }),
  });
  const repositoryState = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });
  const config = loadMitiiHostConfig(options.cwd);
  const workspaceSkillsEnabled = env.MITII_DISABLE_WORKSPACE_SKILLS !== '1';
  const memoryDisabled = env.MITII_DISABLE_MEMORY === '1';
  const repositoryContext = createHostRepositoryContext({
    repositoryState,
    workspaceRoot: options.cwd,
    semanticIndex: resolveCliSemanticIndexSettings({ env, config }),
    git,
  });
  const client = createMitiiClient({
    understandingLlm: ports.understandingLlm,
    runLlm: ports.runLlm,
    workspaceRoot: options.cwd,
    defaultMode: ports.defaultMode === 'agent' ? 'agent' : ports.defaultMode,
    defaultSessionId: 'cli_session',
    workspaceId: ports.workspaceId,
    repositoryState,
    repositoryContext,
    enableInMemoryCheckpoints: false,
    checkpointStore: createWorkspaceCheckpointStore(options.cwd),
    tools,
    verification,
    taskListAutoAdvance: env.MITII_TASK_LIST_AUTO_ADVANCE !== '0',
    skillsCatalog: createFileSystemSkillsCatalog({
      workspaceRoot: workspaceSkillsEnabled ? options.cwd : undefined,
      contentMode: 'metadata',
    }),
    memoryStore: memoryDisabled
      ? undefined
      : createWorkspaceMemoryStore(options.cwd, ports.workspaceId),
    ...options.clientOverrides,
  });
  return { client, ports };
}
