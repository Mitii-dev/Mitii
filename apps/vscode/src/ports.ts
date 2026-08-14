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
  resolveProviderApiKey,
} from '@mitii/host';
import type * as vscode from 'vscode';

import { VscodeDiagnosticsPort } from './diagnosticsPort.js';
import { getSharedMcpManager } from './mcp/manager.js';
import { readMcpSettings } from './mcpConfig.js';
import { findLocalModelPreset } from './modelPresets.js';
import { createHostRepositoryContext } from './repositoryContextHost.js';
import { readContextToggles } from './contextToggles.js';
import { createVsCodeMemoryStore } from './memoryStore.js';
import { createVsCodeCodeNavigationPort } from './codeNavigation.js';
import { resolveVsCodeSemanticIndexSettings } from './semanticIndex.js';

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
  workspaceRoot?: string,
): Promise<VscodePortResolution> {
  const cfg = vs.workspace.getConfiguration('mitii');
  const providerType = cfg.get<string>('provider.type') ?? 'echo';
  const model = cfg.get<string>('provider.model') ?? 'qwen3-coder:30b';
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

  if (providerType === 'echo') {
    return {
      understandingLlm: new LocalUnderstandingLlmPort(),
      runLlm: createHostLlmPorts({ type: 'echo', model: 'echo' }).runLlm,
      providerLabel: 'echo',
      workspaceId,
    };
  }

  const contextWindowTokens = resolveContextWindow(cfg, model);
  const maximumOutputTokens = resolveMaximumOutput(cfg, contextWindowTokens);
  const ports = createHostLlmPorts({
    type: providerType,
    preset: presetId,
    model,
    baseUrl,
    ...(secretKey ? { apiKey: secretKey } : {}),
    capabilities: {
      contextWindowTokens,
      maximumOutputTokens,
      supportsTools: true,
    },
  });
  return {
    understandingLlm: ports.understandingLlm,
    runLlm: ports.runLlm,
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
  const search = createOptionalSearchPort(process.env);
  const git = workspaceRoot ? new NodeGitAdapter() : undefined;
  const codeNavigation = workspaceRoot
    ? createHostCodeNavigationPort({
        workspaceRoot,
        languageServer: createVsCodeCodeNavigationPort(vs, workspaceRoot),
      })
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
          repoGraphs: createHostRepositoryGraphPort({ workspaceRoot }),
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
        })
      : undefined;

  const repositoryContext = workspaceRoot
    ? createHostRepositoryContext({
        repositoryState,
        workspaceRoot,
        semanticIndex: await resolveVsCodeSemanticIndexSettings(vs, secrets),
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
