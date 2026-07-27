import {
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  createDefaultSkillsCatalog,
  createMitiiClient,
  InMemoryRepositoryStateStore,
  RepositoryStatePipeline,
  DEFAULT_TOOL_DEFINITIONS,
  ToolRuntimePipeline,
  NodeProcessAdapter,
  NodeNetworkAdapter,
  NodeWorkspaceFileSystemAdapter,
  type LlmPort,
  type MitiiClient,
  type ModelCapabilities,
  type ModelEvent,
  type ModelRequest,
  type SkillsCatalogPort,
} from '@mitii/sdk';
import type * as vscode from 'vscode';

import { getSharedMcpManager } from './mcp/manager.js';
import { readMcpSettings } from './mcpConfig.js';
import { findLocalModelPreset } from './modelPresets.js';
import { createHostRepositoryContext } from './repositoryContextHost.js';

const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAXIMUM_OUTPUT = 16_384;

export class LocalUnderstandingLlmPort implements LlmPort {
  readonly id = 'vscode-local-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'vscode/local-understanding',
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
        confidence: 0.9,
        alternatives: [],
        needsClarification: false,
        reason: 'VS Code local understanding (no remote provider).',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

export interface VscodePortResolution {
  understandingLlm: LlmPort;
  runLlm: LlmPort;
  providerLabel: string;
  workspaceId: string;
}

function resolveContextWindow(cfg: vscode.WorkspaceConfiguration, model: string): number {
  const fromSetting = cfg.get<number>('provider.contextWindow');
  if (
    typeof fromSetting === 'number' &&
    Number.isFinite(fromSetting) &&
    fromSetting > 0
  ) {
    return Math.floor(fromSetting);
  }
  return (
    findLocalModelPreset(model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  );
}

function resolveMaximumOutput(
  cfg: vscode.WorkspaceConfiguration,
  contextWindowTokens: number,
): number {
  const fromSetting = cfg.get<number>('provider.maximumOutputTokens');
  if (
    typeof fromSetting === 'number' &&
    Number.isFinite(fromSetting) &&
    fromSetting > 0
  ) {
    return Math.min(Math.floor(fromSetting), Math.max(1, contextWindowTokens - 1));
  }
  return Math.min(DEFAULT_MAXIMUM_OUTPUT, Math.max(1, contextWindowTokens - 1));
}

/**
 * Compose LLM ports from mitii.* settings + SecretStorage / env.
 * Secrets never come from settings JSON defaults.
 *
 * openai-compatible does **not** require an API key (Ollama / LM Studio).
 * Only echo forces the local stub ports.
 */
export async function resolveVscodePorts(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
): Promise<VscodePortResolution> {
  const cfg = vs.workspace.getConfiguration('mitii');
  const providerType = cfg.get<string>('provider.type') ?? 'echo';
  const model = cfg.get<string>('provider.model') ?? 'qwen3-coder:30b';
  const baseUrl =
    cfg.get<string>('provider.baseUrl')?.trim() ||
    'http://localhost:11434/v1';
  const workspaceId = 'vscode_workspace';

  const secretKey =
    (await secrets.get('mitii.provider.apiKey')) ??
    process.env.MITII_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (providerType === 'openai-compatible') {
    const contextWindowTokens = resolveContextWindow(cfg, model);
    const maximumOutputTokens = resolveMaximumOutput(cfg, contextWindowTokens);
    const capabilities = {
      contextWindowTokens,
      maximumOutputTokens,
      supportsTools: true,
    };
    const runLlm = new OpenAiCompatibleLlmPort({
      model,
      baseUrl,
      ...(secretKey ? { apiKey: secretKey } : {}),
      capabilities,
    });
    const understandingLlm = new OpenAiCompatibleLlmPort({
      model,
      baseUrl,
      ...(secretKey ? { apiKey: secretKey } : {}),
      capabilities: {
        ...capabilities,
        supportsStructuredOutput: true,
      },
    });
    return {
      understandingLlm,
      runLlm,
      providerLabel: `openai-compatible:${model}`,
      workspaceId,
    };
  }

  return {
    understandingLlm: new LocalUnderstandingLlmPort(),
    runLlm: new EchoLlmPort(),
    providerLabel: 'echo',
    workspaceId,
  };
}

export async function createVscodeClient(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
  workspaceRoot: string | undefined,
  options: { skillsCatalog?: SkillsCatalogPort } = {},
): Promise<{ client: MitiiClient; ports: VscodePortResolution }> {
  const ports = await resolveVscodePorts(vs, secrets);
  const repositoryState = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });

  const mcp = readMcpSettings(vs, workspaceRoot);
  const mcpManager = getSharedMcpManager();
  const mcpSnapshot = await mcpManager.sync(mcp, workspaceRoot);

  const tools = workspaceRoot
    ? new ToolRuntimePipeline(
        {
          fileSystem: new NodeWorkspaceFileSystemAdapter(),
          process: new NodeProcessAdapter(),
          network: new NodeNetworkAdapter(),
        },
        { registry: mcpManager.createRegistry() },
      )
    : undefined;

  const repositoryContext = workspaceRoot
    ? createHostRepositoryContext({
        repositoryState,
        workspaceRoot,
      })
    : undefined;

  const toolDefinitions = [
    ...DEFAULT_TOOL_DEFINITIONS,
    ...mcpSnapshot.toolDefinitions,
  ];

  const client = createMitiiClient({
    understandingLlm: ports.understandingLlm,
    runLlm: ports.runLlm,
    workspaceRoot,
    defaultMode: 'ask',
    defaultSessionId: 'vscode_session',
    workspaceId: ports.workspaceId,
    repositoryState,
    repositoryContext,
    tools,
    toolDefinitions,
    enableInMemoryCheckpoints: true,
    skillsCatalog: options.skillsCatalog ?? createDefaultSkillsCatalog(),
  });
  return { client, ports };
}
