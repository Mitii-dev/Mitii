/**
 * Desktop host client factory.
 *
 * Architecture: apps/desktop → @mitii/host → @mitii/sdk → @mitii/v8
 * Does NOT import apps/cli or apps/acp (REPO_LAYOUT forbids app→app).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createMitiiClient,
  DEFAULT_TOOL_DEFINITIONS,
  InMemoryRepositoryStateStore,
  NodeGitAdapter,
  NodeNetworkAdapter,
  NodeProcessAdapter,
  NodeWorkspaceFileSystemAdapter,
  RepositoryStatePipeline,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceFileSystemManifestReader,
  type AgentMode,
  type LlmPort,
  type MitiiClient,
  type ModelCapabilities,
  type ModelEvent,
  type ModelRequest,
} from '@mitii/sdk';
import {
  createFileSystemSkillsCatalog,
  createHostLanguageServices,
  createHostLlmPorts,
  createHostNetworkPort,
  createHostRepositoryContext,
  createHostRepositoryGraphPort,
  createOptionalSearchPort,
  createSandboxedProcessPort,
  createWorkspaceCheckpointStore,
  createWorkspaceKnowledgeGraph,
  createWorkspaceMemoryStore,
  createWorkspaceVerificationStore,
  detectSandboxBackend,
  getProviderPreset,
  inferHostProviderType,
  isHostProviderType,
  normalizeOllamaModelId,
  resolveMemoryEmbeddingPort,
  resolveProviderApiKey,
  resolveSandboxPolicy,
  type SemanticIndexSettings,
} from '@mitii/host';
import {
  getSharedMcpManager,
  readMcpSettingsFromDisk,
} from '@mitii/mcp';
import Database from 'better-sqlite3';

import type { DesktopHostMode } from '../shared/protocol.js';
import { resolveEffectiveContextWindow } from '../shared/contextWindow.js';
import { ensureDesktopRepositoryState } from './ensureRepositoryState.js';
import { workspaceIdFromRoot } from './workspace-id.js';

interface MitiiDesktopConfig {
  provider?: string;
  providerPreset?: string;
  model?: string;
  baseUrl?: string;
  workspaceId?: string;
  defaultMode?: AgentMode;
}

function readPositiveInt(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Read nested provider.* from MITII_DESKTOP_SETTINGS_JSON when env keys are absent. */
function readDesktopSettingsField(
  env: NodeJS.ProcessEnv,
  dotted: string,
): unknown {
  const json = env.MITII_DESKTOP_SETTINGS_JSON?.trim();
  if (!json) return undefined;
  try {
    const root = JSON.parse(json) as Record<string, unknown>;
    const parts = dotted.split('.');
    let cur: unknown = root;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  } catch {
    return undefined;
  }
}

/** Deterministic understanding for echo / smoke. */
export class DesktopUnderstandingLlmPort implements LlmPort {
  readonly id = 'desktop-local-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'desktop/local-understanding',
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
        reason: 'Desktop local understanding (echo).',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

/**
 * Smoke-mode run LLM — never echoes working_set / tool scaffolding.
 * Real chat requires Settings → Provider (Ollama by default).
 */
export class DesktopSmokeLlmPort implements LlmPort {
  readonly id = 'desktop-smoke-run';
  readonly capabilities: ModelCapabilities = {
    modelId: 'desktop/smoke',
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: false,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    const msg =
      'Mitii Desktop is in smoke/echo mode — this is not a real model reply.\n\n' +
      'Open Settings → Provider, pick Ollama (or another provider), set a model, ' +
      'click Test connection, then Save & apply.';
    yield { type: 'content_delta', content: msg };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

export function loadDesktopMitiiConfig(cwd: string): MitiiDesktopConfig {
  const path = join(cwd, '.mitii', 'config.json');
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      provider: typeof raw.provider === 'string' ? raw.provider : undefined,
      providerPreset:
        typeof raw.providerPreset === 'string' ? raw.providerPreset : undefined,
      model: typeof raw.model === 'string' ? raw.model : undefined,
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
      workspaceId:
        typeof raw.workspaceId === 'string' &&
        raw.workspaceId.trim() &&
        raw.workspaceId !== 'desktop_workspace'
          ? raw.workspaceId.trim()
          : undefined,
      defaultMode:
        raw.defaultMode === 'ask' ||
        raw.defaultMode === 'plan' ||
        raw.defaultMode === 'agent'
          ? raw.defaultMode
          : undefined,
    };
  } catch {
    return {};
  }
}

export function createEchoDesktopClient(cwd: string): MitiiClient {
  const workspaceId = workspaceIdFromRoot(cwd);
  return createMitiiClient({
    understandingLlm: new DesktopUnderstandingLlmPort(),
    runLlm: new DesktopSmokeLlmPort(),
    workspaceRoot: cwd,
    defaultMode: 'ask',
    defaultSessionId: `desktop_${workspaceId}`,
    workspaceId,
  });
}

export async function createHostDesktopClient(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MitiiClient> {
  const config = loadDesktopMitiiConfig(cwd);
  const type =
    (env.MITII_PROVIDER && isHostProviderType(env.MITII_PROVIDER)
      ? env.MITII_PROVIDER
      : undefined) ??
    (config.provider && isHostProviderType(config.provider)
      ? config.provider
      : undefined) ??
    inferHostProviderType(env) ??
    'openai-compatible';
  const forceEcho =
    env.MITII_FORCE_ECHO === '1' ||
    env.MITII_FORCE_ECHO === 'true' ||
    type === 'echo' ||
    config.provider === 'echo';
  const presetId =
    env.MITII_PROVIDER_PRESET ??
    config.providerPreset ??
    (type === 'openai-compatible' ? 'ollama' : type);
  const preset = getProviderPreset(presetId);
  const model = normalizeOllamaModelId(
    env.MITII_MODEL ?? config.model ?? preset?.model ?? 'gpt-4o-mini',
    env.MITII_BASE_URL ?? config.baseUrl ?? preset?.baseUrl,
  );
  const baseUrl = env.MITII_BASE_URL ?? config.baseUrl ?? preset?.baseUrl;
  const apiKey = resolveProviderApiKey({ type, env });

  const storedContextWindow = readPositiveInt(
    env.MITII_CONTEXT_WINDOW ??
      readDesktopSettingsField(env, 'provider.contextWindow'),
  );
  const contextWindowTokens = resolveEffectiveContextWindow(
    storedContextWindow,
    model,
    type,
  );
  const hostMaximumOutputTokens = readPositiveInt(
    env.MITII_MAXIMUM_OUTPUT_TOKENS ??
      readDesktopSettingsField(env, 'provider.maximumOutputTokens'),
  );

  const llm = forceEcho
    ? {
        understandingLlm: new DesktopUnderstandingLlmPort(),
        runLlm: new DesktopSmokeLlmPort(),
      }
    : createHostLlmPorts({
        type,
        preset: presetId,
        model,
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
        capabilities: {
          contextWindowTokens,
          ...(hostMaximumOutputTokens > 0
            ? { maximumOutputTokens: hostMaximumOutputTokens }
            : {}),
          supportsTools: true,
        },
      });

  const mcpManager = getSharedMcpManager({ clientInfoName: 'mitii-desktop' });
  const mcp = readMcpSettingsFromDisk(cwd);
  const mcpSnapshot = await mcpManager.sync(mcp, cwd);

  const fileSystem = new NodeWorkspaceFileSystemAdapter();
  const search = createOptionalSearchPort(env);
  const git = new NodeGitAdapter();
  const knowledgeGraph = createWorkspaceKnowledgeGraph(cwd);
  const language = createHostLanguageServices({ workspaceRoot: cwd });
  const tools = new ToolRuntimePipeline(
    {
      fileSystem,
      process: createSandboxedProcessPort(
        new NodeProcessAdapter(),
        resolveSandboxPolicy({
          enabled: env.MITII_SANDBOX === '1' || env.MITII_SANDBOX === 'true',
          network: env.MITII_SANDBOX_NETWORK === 'allow' ? 'allow' : 'deny',
          workspaceRoot: cwd,
        }),
        detectSandboxBackend(),
      ),
      network: createHostNetworkPort({
        inner: new NodeNetworkAdapter(),
        env,
      }),
      git,
      knowledgeGraph,
      codeNavigation: language.codeNavigation,
      ...(language.diagnostics ? { diagnostics: language.diagnostics } : {}),
      repoGraphs: createHostRepositoryGraphPort({ workspaceRoot: cwd }),
      ...(search ? { search } : {}),
    },
    { registry: mcpManager.createRegistry() },
  );
  const verification = new VerificationPipeline({
    tools,
    manifests: new WorkspaceFileSystemManifestReader({
      fileSystem,
      workspaceRoot: cwd,
    }),
    records: createWorkspaceVerificationStore(cwd),
  });
  const repositoryState = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });
  const workspaceId = config.workspaceId ?? workspaceIdFromRoot(cwd);
  const memoryEnabled = readDesktopSettingsField(env, 'ui.contextToggles.memory');
  const memoryOn = memoryEnabled !== false;
  const semanticSourceRaw = readDesktopSettingsField(env, 'semanticIndex.source');
  const semanticSource =
    semanticSourceRaw === 'ollama' ||
    semanticSourceRaw === 'openai-compatible' ||
    semanticSourceRaw === 'disabled' ||
    semanticSourceRaw === 'bundled'
      ? semanticSourceRaw
      : ('bundled' as const);
  const semanticEnabled = readDesktopSettingsField(env, 'semanticIndex.enabled');
  const semanticModel = readDesktopSettingsField(env, 'semanticIndex.model');
  const semanticDimensions = readDesktopSettingsField(
    env,
    'semanticIndex.dimensions',
  );
  const semanticNormalized = readDesktopSettingsField(
    env,
    'semanticIndex.normalized',
  );
  const semanticIndex: SemanticIndexSettings = {
    enabled: semanticEnabled !== false,
    source: semanticSource,
    model: typeof semanticModel === 'string' ? semanticModel : '',
    dimensions:
      typeof semanticDimensions === 'number' && semanticDimensions > 0
        ? Math.floor(semanticDimensions)
        : 0,
    normalized: semanticNormalized !== false,
    baseUrl: baseUrl ?? '',
    ...(apiKey ? { apiKey } : {}),
  };
  const openDatabase = ((
    filename: string,
    openOptions?: { readonly?: boolean; fileMustExist?: boolean },
  ) => new Database(filename, openOptions)) as never;
  const repositoryContext = createHostRepositoryContext({
    repositoryState,
    workspaceRoot: cwd,
    semanticIndex,
    git,
    openDatabase,
  });

  const client = createMitiiClient({
    understandingLlm: llm.understandingLlm,
    runLlm: llm.runLlm,
    workspaceRoot: cwd,
    defaultMode:
      config.defaultMode === 'agent'
        ? 'agent'
        : (config.defaultMode ?? 'ask'),
    defaultSessionId: `desktop_${workspaceId}`,
    workspaceId,
    repositoryState,
    repositoryContext,
    tools,
    verification,
    toolDefinitions: [
      ...DEFAULT_TOOL_DEFINITIONS,
      ...mcpSnapshot.toolDefinitions,
    ],
    enableInMemoryCheckpoints: false,
    checkpointStore: createWorkspaceCheckpointStore(cwd),
    ...(memoryOn
      ? {
          memoryStore: createWorkspaceMemoryStore(cwd, workspaceId),
          memoryEmbedding: resolveMemoryEmbeddingPort(semanticIndex),
        }
      : {}),
    skillsCatalog: createFileSystemSkillsCatalog({
      workspaceRoot: cwd,
      contentMode: 'metadata',
    }),
  });

  await ensureDesktopRepositoryState({
    client,
    workspaceRoot: cwd,
    workspaceId,
  });

  return client;
}

export async function createDesktopClient(options: {
  cwd: string;
  forceEcho?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<{ client: MitiiClient; mode: DesktopHostMode }> {
  const env = options.env ?? process.env;
  const forceEcho =
    options.forceEcho === true ||
    env.MITII_FORCE_ECHO === '1' ||
    env.MITII_FORCE_ECHO === 'true';
  if (forceEcho) {
    return { client: createEchoDesktopClient(options.cwd), mode: 'echo' };
  }
  return {
    client: await createHostDesktopClient(options.cwd, env),
    mode: 'host',
  };
}
