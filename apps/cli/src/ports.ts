import {
  MemoryPipeline,
  type CreateMitiiClientOptions,
  type LlmPort,
  type MitiiClient,
  type ModelCapabilities,
  type ModelEvent,
  type ModelRequest,
} from '@mitii/sdk';
import {
  bindHostMcp,
  createHostClient,
  createHostLlmPorts,
  createHeuristicAdversary,
  getProviderPreset,
  inferHostProviderType,
  isHostProviderType,
  readSandboxOptionsFromEnv,
  resolveHostContextWindowTokens,
  resolveProviderApiKey,
  type MemoryCaptureContext,
} from '@mitii/host';
import {
  getSharedMcpManager,
  readMcpSettingsFromDisk,
} from '@mitii/mcp';

import {
  loadMitiiHostConfig,
  resolveCliWorkspaceId,
  type MitiiHostConfig,
} from './config.js';
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
  const workspaceId = resolveCliWorkspaceId(config);
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
    capabilities: {
      contextWindowTokens: resolveHostContextWindowTokens({
        env,
        model,
        providerType: type,
        configContextWindowTokens: config.contextWindowTokens,
      }),
      supportsTools: true,
    },
  });
  return {
    understandingLlm: ports.understandingLlm,
    runLlm: ports.runLlm,
    providerLabel: ports.providerLabel,
    workspaceId,
    defaultMode,
  };
}

/**
 * Client + resolved ports + memory capture. REPL sessions build this once and
 * reuse it so the in-memory repository state (and MCP sync) survive across turns.
 */
export interface CliRuntime {
  client: MitiiClient;
  ports: ResolvedCliPorts;
  memoryCapture?: MemoryCaptureContext;
}

export async function createCliClient(options: {
  cwd: string;
  forceEcho?: boolean;
  env?: NodeJS.ProcessEnv;
  clientOverrides?: Partial<CreateMitiiClientOptions>;
}): Promise<CliRuntime> {
  const env = options.env ?? process.env;
  const config = loadMitiiHostConfig(options.cwd);
  const ports = resolveCliPorts({
    forceEcho: options.forceEcho,
    env: options.env,
    cwd: options.cwd,
    config,
  });
  const searxngBaseUrl = config.searxngBaseUrl?.trim() || undefined;
  const semanticIndex = resolveCliSemanticIndexSettings({ env, config });
  const adversary = createHeuristicAdversary({
    enabled: env.MITII_ADVERSARY === '1' || env.MITII_ADVERSARY === 'true',
  });
  const adversaryFailMode =
    env.MITII_ADVERSARY_FAIL === 'open' ? ('fail_open' as const) : ('fail_closed' as const);

  const composition = await createHostClient({
    workspaceRoot: options.cwd,
    workspaceId: ports.workspaceId,
    llm: {
      understandingLlm: ports.understandingLlm,
      runLlm: ports.runLlm,
    },
    env,
    defaultMode: ports.defaultMode,
    defaultSessionId: 'cli_session',
    taskListAutoAdvance: env.MITII_TASK_LIST_AUTO_ADVANCE !== '0',
    sandbox: readSandboxOptionsFromEnv(env),
    ...(searxngBaseUrl ? { search: { searxngBaseUrl } } : {}),
    mcp: bindHostMcp(
      getSharedMcpManager({ clientInfoName: 'mitii-cli' }),
      readMcpSettingsFromDisk(options.cwd),
      options.cwd,
    ),
    skills: { workspaceSkills: env.MITII_DISABLE_WORKSPACE_SKILLS !== '1' },
    ...(env.MITII_DISABLE_MEMORY === '1' ? {} : { memory: { semanticIndex } }),
    repositoryContext: ({ repositoryState, workspaceRoot, git }) =>
      createHostRepositoryContext({
        repositoryState,
        workspaceRoot,
        semanticIndex,
        git,
      }),
    clientOptions: {
      ...(adversary ? { adversary, adversaryFailMode } : {}),
      ...options.clientOverrides,
    },
  });
  const { client, memoryStore, memoryEmbedding } = composition;
  return {
    client,
    ports,
    ...(memoryStore
      ? {
          memoryCapture: {
            workspaceRoot: options.cwd,
            workspaceId: ports.workspaceId,
            pipeline: new MemoryPipeline({
              store: memoryStore,
              embedding: memoryEmbedding,
            }),
          },
        }
      : {}),
  };
}
