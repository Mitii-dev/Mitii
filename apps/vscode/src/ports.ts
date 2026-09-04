import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import {
  createMitiiClient,
  InMemoryRepositoryStateStore,
  RepositoryStatePipeline,
  DEFAULT_TOOL_DEFINITIONS,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceFileSystemManifestReader,
  NodeProcessAdapter,
  NodeNetworkAdapter,
  NodeWorkspaceFileSystemAdapter,
  NodeGitAdapter,
  type LlmPort,
  type MitiiClient,
  type ModelCapabilities,
  type ModelEvent,
  type ModelRequest,
  type SkillsCatalogPort,
} from '@mitii/sdk';
import {
  createFileSystemSkillsCatalog,
  createHostCodeNavigationPort,
  createHostLlmPorts,
  createHostRepositoryGraphPort,
  createOptionalSearchPort,
  createWorkspaceCheckpointStore,
  createWorkspaceVerificationStore,
  resolveMemoryEmbeddingPort,
  resolveProviderApiKey,
} from '@mitii/host';
import type * as vscode from 'vscode';

import { VscodeDiagnosticsPort } from './diagnosticsPort.js';
import { getSharedMcpManager } from './mcp/manager.js';
import { readMcpSettings } from './mcpConfig.js';
import { createHostRepositoryContext } from './repositoryContextHost.js';
import { readContextToggles } from './contextToggles.js';
import { createVsCodeMemoryStore } from './memoryStore.js';
import { createVsCodeCodeNavigationPort } from './codeNavigation.js';
import { resolveVsCodeSemanticIndexSettings } from './semanticIndex.js';
import {
  isModelIoLoggingEnabled,
  wrapLlmPortForModelIo,
} from './modelIoLog.js';
import { readModelIoLoggingEnabled } from './modelIoSettings.js';
import {
  normalizeMaximumOutputTokens,
  resolveEffectiveContextWindow,
} from './settingsFields.js';

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

/**
 * Settings context window is the source of truth when positive.
 * Auto (0) falls back to model / provider presets.
 */
export function resolveContextWindowFromSettings(
  cfg: vscode.WorkspaceConfiguration,
  model: string,
  providerType?: string,
): number {
  const fromSetting = cfg.get<number>('provider.contextWindow');
  const stored =
    typeof fromSetting === 'number' && Number.isFinite(fromSetting)
      ? Math.floor(fromSetting)
      : 0;
  return resolveEffectiveContextWindow(stored, model, providerType);
}

/**
 * Raw host max-output setting. 0 / legacy 5000 → derive in Window Budget.
 * Never pre-derive here — that falsely becomes output_host_override.
 */
export function resolveHostMaximumOutputTokens(
  cfg: vscode.WorkspaceConfiguration,
): number {
  return normalizeMaximumOutputTokens(
    cfg.get<number>('provider.maximumOutputTokens'),
  );
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
  workspaceRoot?: string,
): Promise<VscodePortResolution> {
  const cfg = vs.workspace.getConfiguration('mitii');
  const providerType = cfg.get<string>('provider.type') ?? 'echo';
  const model = cfg.get<string>('provider.model') ?? '';
  const baseUrl =
    cfg.get<string>('provider.baseUrl')?.trim() ||
    'http://localhost:11434/v1';
  const workspaceId = resolveWorkspaceId(workspaceRoot);

  const secretKey = resolveProviderApiKey({
    type: providerType,
    env: process.env,
    secretKey:
      (await secrets.get('mitii.provider.apiKey')) ?? undefined,
  });
  const presetId = cfg.get<string>('provider.preset') ?? providerType;

  const modelIoEnabled = isModelIoLoggingEnabled(
    cfg.get<boolean>('developer.enabled') ?? false,
    readModelIoLoggingEnabled(cfg),
  );

  if (providerType === 'echo') {
    return {
      understandingLlm: wrapLlmPortForModelIo(
        new LocalUnderstandingLlmPort(),
        modelIoEnabled,
      ),
      runLlm: wrapLlmPortForModelIo(
        createHostLlmPorts({ type: 'echo', model: 'echo' }).runLlm,
        modelIoEnabled,
      ),
      providerLabel: 'echo',
      workspaceId,
    };
  }

  const contextWindowTokens = resolveContextWindowFromSettings(
    cfg,
    model,
    providerType,
  );
  const hostMaximumOutputTokens = resolveHostMaximumOutputTokens(cfg);
  const ports = createHostLlmPorts({
    type: providerType,
    preset: presetId,
    model,
    baseUrl,
    ...(secretKey ? { apiKey: secretKey } : {}),
    capabilities: {
      contextWindowTokens,
      // Only forward a real host override. Omitting lets the adapter advertise
      // a capability default without Window Budget treating it as an override.
      ...(hostMaximumOutputTokens > 0
        ? { maximumOutputTokens: hostMaximumOutputTokens }
        : {}),
      supportsTools: true,
    },
  });
  return {
    understandingLlm: wrapLlmPortForModelIo(
      ports.understandingLlm,
      modelIoEnabled,
    ),
    runLlm: wrapLlmPortForModelIo(ports.runLlm, modelIoEnabled),
    providerLabel: ports.providerLabel,
    workspaceId,
  };
}

export async function createVscodeClient(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
  workspaceRoot: string | undefined,
  options: {
    skillsCatalog?: SkillsCatalogPort;
    workspaceState?: vscode.Memento;
  } = {},
): Promise<{ client: MitiiClient; ports: VscodePortResolution }> {
  const ports = await resolveVscodePorts(vs, secrets, workspaceRoot);
  const repositoryState = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });

  const mcp = readMcpSettings(vs, workspaceRoot);
  const mcpManager = getSharedMcpManager();
  const mcpSnapshot = await mcpManager.sync(mcp, workspaceRoot);

  const fileSystem = workspaceRoot
    ? new NodeWorkspaceFileSystemAdapter()
    : undefined;
  const searchEnv = process.env;
  const searchApiKey =
    (await secrets.get('mitii.search.apiKey'))?.trim() ||
    searchEnv.MITII_SEARCH_API_KEY?.trim() ||
    searchEnv.BRAVE_API_KEY?.trim() ||
    undefined;
  const search = searchApiKey
    ? createOptionalSearchPort({ env: searchEnv, apiKey: searchApiKey })
    : createOptionalSearchPort(searchEnv);
  const git = workspaceRoot ? new NodeGitAdapter() : undefined;
  const codeNavigation = workspaceRoot
    ? createHostCodeNavigationPort({
        workspaceRoot,
        languageServer: createVsCodeCodeNavigationPort(vs, workspaceRoot),
      })
    : undefined;
  const repoGraphs = workspaceRoot
    ? createHostRepositoryGraphPort({ workspaceRoot })
    : undefined;
  const tools = workspaceRoot && fileSystem
    ? new ToolRuntimePipeline(
        {
          fileSystem,
          process: new NodeProcessAdapter(),
          network: new NodeNetworkAdapter(),
          git,
          diagnostics: new VscodeDiagnosticsPort(vs, workspaceRoot),
          ...(search ? { search } : {}),
          ...(codeNavigation ? { codeNavigation } : {}),
          ...(repoGraphs ? { repoGraphs } : {}),
        },
        { registry: mcpManager.createRegistry() },
      )
    : undefined;

  const verification =
    workspaceRoot && tools && fileSystem
      ? new VerificationPipeline({
          tools,
          manifests: new WorkspaceFileSystemManifestReader({
            fileSystem,
            workspaceRoot,
          }),
          records: createWorkspaceVerificationStore(workspaceRoot),
        })
      : undefined;

  const semanticIndex = workspaceRoot
    ? await resolveVsCodeSemanticIndexSettings(vs, secrets)
    : undefined;
  const repositoryContext = workspaceRoot
    ? createHostRepositoryContext({
        repositoryState,
        workspaceRoot,
        semanticIndex,
        ...(git ? { git } : {}),
        resolveEditorReferences: () =>
          resolveVsCodeEditorReferences(vs, workspaceRoot),
      })
    : undefined;

  const toolDefinitions = [
    ...DEFAULT_TOOL_DEFINITIONS,
    ...mcpSnapshot.toolDefinitions,
  ];
  const memoryEnabled = readContextToggles(vs).memory;
  const workspaceSkillsEnabled =
    vs.workspace
      .getConfiguration('mitii')
      .get<boolean>('skills.workspace.enabled') ?? true;

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
    ...(repoGraphs ? { repoGraphs } : {}),
    verification,
    toolDefinitions,
    enableInMemoryCheckpoints: false,
    taskListAutoAdvance:
      vs.workspace
        .getConfiguration('mitii')
        .get<boolean>('agent.taskListAutoAdvance') ?? true,
    ...(workspaceRoot
      ? { checkpointStore: createWorkspaceCheckpointStore(workspaceRoot) }
      : {}),
    skillsCatalog:
      options.skillsCatalog ??
      createFileSystemSkillsCatalog({
        workspaceRoot: workspaceSkillsEnabled ? workspaceRoot : undefined,
        contentMode: 'metadata',
      }),
    memoryStore:
      memoryEnabled && options.workspaceState
        ? createVsCodeMemoryStore(options.workspaceState, ports.workspaceId)
        : undefined,
    memoryEmbedding: memoryEnabled
      ? resolveMemoryEmbeddingPort(semanticIndex)
      : undefined,
  });
  return { client, ports };
}

function resolveWorkspaceId(workspaceRoot: string | undefined): string {
  if (!workspaceRoot) return 'vscode_workspace';
  const normalized = workspaceRoot.replace(/\\/g, '/');
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 12);
  return `vscode_workspace_${hash}`;
}

function toWorkspaceRelativePath(
  workspaceRoot: string,
  filePath: string,
): string | undefined {
  const relativePath = relative(workspaceRoot, filePath).replace(/\\/g, '/');
  if (
    !relativePath ||
    relativePath.startsWith('../') ||
    relativePath === '..' ||
    relativePath.startsWith('/')
  ) {
    return undefined;
  }
  return relativePath;
}

function resolveVsCodeEditorReferences(
  vs: typeof vscode,
  workspaceRoot: string,
): {
  currentFile?: { relativePath: string };
  openFiles: Array<{ relativePath: string }>;
} {
  const seen = new Set<string>();
  const openFiles: Array<{ relativePath: string }> = [];

  for (const editor of vs.window.visibleTextEditors) {
    if (editor.document.isUntitled || editor.document.uri.scheme !== 'file') {
      continue;
    }
    const relativePath = toWorkspaceRelativePath(
      workspaceRoot,
      editor.document.uri.fsPath,
    );
    if (!relativePath || seen.has(relativePath)) continue;
    seen.add(relativePath);
    openFiles.push({ relativePath });
  }

  const active = vs.window.activeTextEditor;
  const currentRelative =
    active &&
    !active.document.isUntitled &&
    active.document.uri.scheme === 'file'
      ? toWorkspaceRelativePath(workspaceRoot, active.document.uri.fsPath)
      : undefined;

  return {
    ...(currentRelative ? { currentFile: { relativePath: currentRelative } } : {}),
    openFiles,
  };
}
