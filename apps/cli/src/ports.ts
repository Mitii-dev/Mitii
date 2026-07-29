import {
  EchoLlmPort,
  InMemoryRepositoryStateStore,
  NodeNetworkAdapter,
  NodeProcessAdapter,
  NodeWorkspaceFileSystemAdapter,
  OpenAiCompatibleLlmPort,
  RepositoryStatePipeline,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceFileSystemManifestReader,
  createDefaultSkillsCatalog,
  createMitiiClient,
  type CreateMitiiClientOptions,
  type MitiiClient,
} from '@mitii/sdk';
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
  const apiKey = env.MITII_API_KEY ?? env.OPENAI_API_KEY;
  const forceEcho =
    options.forceEcho === true ||
    env.MITII_FORCE_ECHO === '1' ||
    config.provider === 'echo';
  const workspaceId = config.workspaceId ?? 'cli_workspace';
  const defaultMode = config.defaultMode ?? 'ask';

  if (!forceEcho && (apiKey || config.provider === 'openai-compatible')) {
    if (!apiKey) {
      return {
        understandingLlm: new LocalUnderstandingLlmPort(),
        runLlm: new EchoLlmPort(),
        providerLabel: 'echo (missing API key)',
        workspaceId,
        defaultMode,
      };
    }
    const model = env.MITII_MODEL ?? config.model ?? 'gpt-4o-mini';
    const baseUrl = env.MITII_BASE_URL ?? config.baseUrl;
    const runLlm = new OpenAiCompatibleLlmPort({
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
    const understandingLlm = new OpenAiCompatibleLlmPort({
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      capabilities: { supportsStructuredOutput: true },
    });
    return {
      understandingLlm,
      runLlm,
      providerLabel: `openai-compatible:${model}`,
      workspaceId,
      defaultMode,
    };
  }

  return {
    understandingLlm: new LocalUnderstandingLlmPort(),
    runLlm: new EchoLlmPort(),
    providerLabel: 'echo',
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
  const fileSystem = new NodeWorkspaceFileSystemAdapter();
  const tools = new ToolRuntimePipeline({
    fileSystem,
    process: new NodeProcessAdapter(),
    network: new NodeNetworkAdapter(),
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
  const env = options.env ?? process.env;
  const config = loadMitiiHostConfig(options.cwd);
  const repositoryContext = createHostRepositoryContext({
    repositoryState,
    workspaceRoot: options.cwd,
    semanticIndex: resolveCliSemanticIndexSettings({ env, config }),
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
    enableInMemoryCheckpoints: true,
    tools,
    verification,
    skillsCatalog: createDefaultSkillsCatalog(),
    ...options.clientOverrides,
  });
  return { client, ports };
}
