import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import {
  NodeProcessAdapter,
  type LlmPort,
  type MitiiClient,
  type ModelCapabilities,
  type ModelEvent,
  type ModelRequest,
  type SkillsCatalogPort,
} from '@mitii/sdk';
import {
  createHostClient,
  createHostCodeNavigationPort,
  createHostLlmPorts,
  detectSandboxBackend,
  isModelIoLoggingEnabled,
  resolveProviderApiKey,
  type HostMcpPort,
  type SandboxBackendPrefer,
  wrapLlmPortForModelIo,
} from '@mitii/host';
import type * as vscode from 'vscode';

import { createLiveSandboxedProcessPort } from './liveSandboxProcess.js';
import { VscodeDiagnosticsPort } from './diagnosticsPort.js';
import { getSharedMcpManager } from './mcp/manager.js';
import { defaultMcpSettings, readMcpSettings } from './mcpConfig.js';
import { createHostRepositoryContext } from './repositoryContextHost.js';
import { readContextToggles } from './contextToggles.js';
import { createVsCodeMemoryStore } from './memoryStore.js';
import { createVsCodeCodeNavigationPort } from './codeNavigation.js';
import { resolveVsCodeSemanticIndexSettings } from './semanticIndex.js';
import { readModelIoLoggingEnabled } from './modelIoSettings.js';
import {
  clampMaximumOutputTokensToContext,
  inferMaximumOutputTokensFromModelId,
  normalizeMaximumOutputTokens,
  resolveEffectiveContextWindow,
} from './settingsFields.js';
import { deriveLiveTokenBudgetPreview } from '@mitii/ui-core';
import { readTokenBudgetPolicyOverrides } from './tokenBudgetSettings.js';

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
  const capabilityMaximumOutputTokens = clampMaximumOutputTokensToContext(
    hostMaximumOutputTokens > 0
      ? hostMaximumOutputTokens
      : (inferMaximumOutputTokensFromModelId(model) ?? 0),
    contextWindowTokens,
  );
  const ports = createHostLlmPorts({
    type: providerType,
    preset: presetId,
    model,
    baseUrl,
    ...(secretKey ? { apiKey: secretKey } : {}),
    capabilities: {
      contextWindowTokens,
      // Capabilities advertise the provider hard max. Window Budget still
      // receives only the explicit host setting via start input — inferred
      // max must not become a false output_host_override.
      ...(capabilityMaximumOutputTokens > 0
        ? { maximumOutputTokens: capabilityMaximumOutputTokens }
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
  const cfg = vs.workspace.getConfiguration('mitii');

  // Untrusted folders: skip project MCP (no connect) and keep Ask-only defaultMode.
  const workspaceTrusted = vs.workspace.isTrusted !== false;
  const mcp = workspaceTrusted
    ? readMcpSettings(vs, workspaceRoot)
    : defaultMcpSettings();
  const mcpManager = getSharedMcpManager();
  const mcpPort: HostMcpPort = {
    sync: async () => {
      const snapshot = await mcpManager.sync(mcp, workspaceRoot);
      logMcpSnapshot(mcp.enabled, snapshot);
      return snapshot;
    },
    createRegistry: () => mcpManager.createRegistry(),
  };

  const searchApiKey =
    (await secrets.get('mitii.search.apiKey'))?.trim() ||
    process.env.MITII_SEARCH_API_KEY?.trim() ||
    process.env.BRAVE_API_KEY?.trim() ||
    undefined;
  const searxngBaseUrl =
    cfg.get<string>('search.searxngBaseUrl')?.trim() || undefined;
  const sandboxBackendRaw = cfg.get<string>('safety.sandbox.backend') ?? 'auto';
  const sandboxPrefer: SandboxBackendPrefer =
    sandboxBackendRaw === 'docker' ||
    sandboxBackendRaw === 'podman' ||
    sandboxBackendRaw === 'seatbelt' ||
    sandboxBackendRaw === 'bubblewrap' ||
    sandboxBackendRaw === 'auto'
      ? sandboxBackendRaw
      : 'auto';

  const semanticIndex = workspaceRoot
    ? await resolveVsCodeSemanticIndexSettings(vs, secrets)
    : undefined;
  const injectionBudget = deriveLiveTokenBudgetPreview({
    contextWindowTokens: resolveContextWindowFromSettings(
      cfg,
      cfg.get<string>('provider.model') ?? '',
      cfg.get<string>('provider.type') ?? '',
    ),
    policy: readTokenBudgetPolicyOverrides(cfg),
  });
  const memoryEnabled = readContextToggles(vs).memory;
  const rawEngine = cfg.get<string>('engine.implementation');

  const { client } = await createHostClient({
    workspaceRoot,
    workspaceId: ports.workspaceId,
    llm: {
      understandingLlm: ports.understandingLlm,
      runLlm: ports.runLlm,
    },
    // Ask-only ceiling until the folder is trusted (and the product default otherwise).
    defaultMode: 'ask',
    defaultSessionId: 'vscode_session',
    taskListAutoAdvance: cfg.get<boolean>('agent.taskListAutoAdvance') ?? true,
    mcp: mcpPort,
    search: {
      ...(searchApiKey ? { apiKey: searchApiKey } : {}),
      ...(searxngBaseUrl ? { searxngBaseUrl } : {}),
    },
    fuzzyMatchDefault: cfg.get<boolean>('tools.applyPatch.fuzzyMatch') === true,
    ...(workspaceRoot
      ? {
          processPort: createLiveSandboxedProcessPort(
            vs,
            new NodeProcessAdapter(),
            workspaceRoot,
            detectSandboxBackend({ prefer: sandboxPrefer }),
          ),
          codeNavigation: createHostCodeNavigationPort({
            workspaceRoot,
            languageServer: createVsCodeCodeNavigationPort(vs, workspaceRoot),
          }),
          diagnostics: new VscodeDiagnosticsPort(vs, workspaceRoot),
        }
      : {}),
    skills: {
      ...(options.skillsCatalog ? { catalog: options.skillsCatalog } : {}),
      workspaceSkills:
        cfg.get<boolean>('skills.workspace.enabled') ?? true,
    },
    ...(memoryEnabled && options.workspaceState
      ? {
          memory: {
            store: createVsCodeMemoryStore(
              options.workspaceState,
              ports.workspaceId,
            ),
            ...(semanticIndex ? { semanticIndex } : {}),
          },
        }
      : {}),
    repositoryContext: ({ repositoryState, workspaceRoot: root, git }) =>
      createHostRepositoryContext({
        repositoryState,
        workspaceRoot: root,
        semanticIndex,
        git,
        resolveEditorReferences: () => resolveVsCodeEditorReferences(vs, root),
        injection: {
          repoMapChars: injectionBudget.injectionRepoMapChars,
          repoMapFilesMax: injectionBudget.injectionRepoMapFilesMax,
          sketchChars: injectionBudget.injectionSketchChars,
          sketchItemsMax: injectionBudget.injectionSketchItemsMax,
        },
      }),
    clientOptions: {
      engineImplementation: rawEngine === 'legacy' ? 'legacy' : 'v8',
    },
  });
  return { client, ports };
}

function logMcpSnapshot(
  enabled: boolean,
  snapshot: {
    servers: ReadonlyArray<{ id: string; status: string; error?: string }>;
    toolDefinitions: readonly unknown[];
  },
): void {
  const ready = snapshot.servers.filter((s) => s.status === 'ready');
  const errors = snapshot.servers.filter((s) => s.status === 'error');
  if (!enabled && snapshot.servers.length === 0) return;
  // Surface connect results in the Extension Host console (Output → Mitii
  // also shows runtime status from the Settings UI).
  console.info(
    `[mitii:mcp] enabled=${enabled} ready=${ready.length} error=${errors.length} tools=${snapshot.toolDefinitions.length}`,
  );
  for (const server of errors) {
    console.warn(`[mitii:mcp] ${server.id} failed: ${server.error ?? 'unknown'}`);
  }
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
