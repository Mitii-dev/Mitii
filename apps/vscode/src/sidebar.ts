import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as vscode from 'vscode';

import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type MitiiClient,
  type MitiiResumeInput,
} from '@mitii/sdk';
import { loadDiskSkills } from '@mitii/host';
import type { SkillDescriptor } from '@mitii/v8';

import {
  appendTurn,
  clearHistory,
  deleteThread,
  loadCheckpoints,
  loadHistory,
  newThreadId,
  saveCheckpoints,
  saveHistory,
  toThreadSummaries,
} from './chatHistory.js';
import type { StoredThread } from './chatHistory.js';
import type { InlineDiffManager } from './diff/inlineDiffManager.js';
import {
  showPatchDiffPreview,
  showWriteDiffPreview,
} from './diff/diffPreview.js';
import {
  buildRunFileChangesView,
  createFileChangeRunSnapshot,
  listDirtyGitPaths,
  noteMutatedPaths,
  noteMutatedPathsFromEvent,
  undoRunFileChanges,
  type FileChangeRunSnapshot,
} from './fileChanges.js';
import { runAskInOutputChannel } from './hostAsk.js';
import { buildContextUsageBreakdown } from './contextUsage.js';
import { getSharedMcpManager } from './mcp/manager.js';
import {
  readMcpSettings,
  readMcpStoreCatalog,
  writeMcpSettings,
} from './mcpConfig.js';
import { scaffoldMitiiWorkspace } from './mitiiWorkspace.js';
import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import { resolveVsCodeSemanticIndexSettings } from './semanticIndex.js';
import { findLocalModelPreset, LOCAL_MODEL_PRESETS } from './modelPresets.js';
import { searchWorkspacePaths } from './pathSearch.js';
import type {
  HostToWebviewMessage,
  IndexStatusSnapshot,
  McpRuntimeStatus,
  PlanView,
  ProviderSettingsSnapshot,
  RunBudgetSettingsSnapshot,
  RunUsagePayload,
  TokenUsageSnapshot,
  UiSettingsSnapshot,
  WebviewToHostMessage,
  WorkspaceNoticeView,
  WorkspaceSnapshotInfo,
} from './protocol.js';
import { planViewFromArtifact } from './planView.js';
import {
  buildConversationCarry,
  resolvePlanHandoff,
} from './conversationCarry.js';
import {
  resolveContextToggles,
  readContextToggles,
} from './contextToggles.js';
import { savePlanToWorkspace } from './planStore.js';
import { buildReviewDiff } from './reviewDiff.js';
import { testProviderConnection } from './testConnection.js';
import { getWorkspaceTrustSnapshot } from './workspace/trust.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';
import {
  clearMemoriesForWorkspace,
  commitMemoryForWorkspace,
  deleteMemoryForWorkspace,
  estimateMemoryPromptBlock,
  loadMemoriesForView,
} from './memoryStore.js';

const DEFAULT_CONTEXT_WINDOW = 32768;
const DEFAULT_RUN_BUDGET: RunBudgetSettingsSnapshot = {
  unlimited: false,
  maxModelCalls: 64,
  maxToolCalls: 128,
  maxLoopIterations: 96,
  maxWallTimeMinutes: 30,
};

function readRunBudgetSettings(vs: typeof vscode): RunBudgetSettingsSnapshot {
  const cfg = vs.workspace.getConfiguration('mitii');
  const readPositive = (
    key: string,
    fallback: number,
    minimum: number,
  ): number => {
    const value = cfg.get<number>(key);
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= minimum
    ) {
      return Math.floor(value);
    }
    return fallback;
  };
  return {
    unlimited: cfg.get<boolean>('runBudget.unlimited') ?? false,
    maxModelCalls: readPositive(
      'runBudget.maxModelCalls',
      DEFAULT_RUN_BUDGET.maxModelCalls,
      1,
    ),
    maxToolCalls: readPositive(
      'runBudget.maxToolCalls',
      DEFAULT_RUN_BUDGET.maxToolCalls,
      1,
    ),
    maxLoopIterations: readPositive(
      'runBudget.maxLoopIterations',
      DEFAULT_RUN_BUDGET.maxLoopIterations,
      1,
    ),
    maxWallTimeMinutes: readPositive(
      'runBudget.maxWallTimeMinutes',
      DEFAULT_RUN_BUDGET.maxWallTimeMinutes,
      1,
    ),
  };
}

function resolveContextWindow(vs: typeof vscode): number {
  const cfg = vs.workspace.getConfiguration('mitii');
  const fromSetting = cfg.get<number>('provider.contextWindow');
  if (
    typeof fromSetting === 'number' &&
    Number.isFinite(fromSetting) &&
    fromSetting > 0
  ) {
    return Math.floor(fromSetting);
  }
  const model = cfg.get<string>('provider.model') ?? '';
  return findLocalModelPreset(model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

function emptyTokenUsage(contextWindow = DEFAULT_CONTEXT_WINDOW): TokenUsageSnapshot {
  return {
    sessionTotal: 0,
    inputTokensTotal: 0,
    outputTokensTotal: 0,
    currentTurnTotal: 0,
    currentTurnInputTokens: 0,
    currentTurnOutputTokens: 0,
    aiCallCount: 0,
    modelCalls: 0,
    toolCalls: 0,
    loopIterations: 0,
    lastPromptTokens: 0,
    lastResponseTokens: 0,
    turnCount: 0,
    contextWindow,
    estimated: true,
    turns: [],
    live: false,
  };
}

interface RepositoryCapabilitySnapshot {
  capability: string;
  status: string;
  reasonCode?: string;
}

interface RepositoryRootSnapshot {
  rootId: string;
  projectCatalogRevision: string;
  codeIndexRevision?: string;
  textIndexRevision?: string;
  vectorProfile?: string;
  vectorIndexRevision?: string;
  graphRevision?: string;
  mapRevision?: string;
  capabilities: RepositoryCapabilitySnapshot[];
}

interface RepositoryDescriptorSnapshot {
  workspaceId: string;
  stateToken: string;
  readiness: string;
  scanCompleteness: string;
  cleanupAllowed: boolean;
  generatedAt: string;
  roots: RepositoryRootSnapshot[];
}

type PersistedIndexState = RepositoryDescriptorSnapshot & {
  fileCount?: number;
  truncated?: boolean;
  indexMode?: IndexStatusSnapshot['indexMode'];
  reasons?: Array<{ message?: string }>;
};

function capabilityRevision(
  root: RepositoryRootSnapshot,
  capability: string,
): string | undefined {
  switch (capability) {
    case 'codeIndex':
      return root.codeIndexRevision;
    case 'textIndex':
      return root.textIndexRevision;
    case 'vectorIndex':
      return root.vectorIndexRevision;
    case 'graph':
      return root.graphRevision;
    case 'map':
      return root.mapRevision;
    case 'catalog':
      return root.projectCatalogRevision;
    default:
      return undefined;
  }
}

function indexStatusFromDescriptor(
  descriptor: RepositoryDescriptorSnapshot,
): Partial<IndexStatusSnapshot> {
  return {
    readiness: descriptor.readiness,
    scanCompleteness: descriptor.scanCompleteness,
    cleanupAllowed: descriptor.cleanupAllowed,
    rootCount: descriptor.roots.length,
    stateTokenPreview: descriptor.stateToken?.slice(0, 16),
    lastIndexedAt: descriptor.generatedAt,
    capabilities: descriptor.roots.flatMap((root) =>
      root.capabilities.map((entry) => ({
        rootId: root.rootId,
        capability: entry.capability,
        status: entry.status,
        reasonCode: entry.reasonCode,
        revision: capabilityRevision(root, entry.capability),
        profile:
          entry.capability === 'vectorIndex' ? root.vectorProfile : undefined,
      })),
    ),
  };
}

function needsFullIndexRefresh(index: IndexStatusSnapshot): boolean {
  if (index.indexMode === 'host_snapshot') return true;
  const capabilities = index.capabilities ?? [];
  if (capabilities.length === 0) return false;
  const core = new Set(['codeIndex', 'textIndex', 'graph', 'map']);
  for (const capability of core) {
    if (
      !capabilities.some(
        (entry) =>
          entry.capability === capability && entry.status === 'ready',
      )
    ) {
      return true;
    }
  }
  return false;
}

export interface SidebarHostOptions {
  extensionMode: vscode.ExtensionMode;
  workspaceState: vscode.Memento;
  inlineDiff: InlineDiffManager;
  onInlineDiffPending: (pending: boolean) => void;
}

export interface SidebarHostHelpers {
  showWriteDiffPreview: (relPath: string, content: string) => Promise<void>;
}

/**
 * Premium React sidebar host bridge over @mitii/sdk.
 */
export class MitiiSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mitii.sidebar';

  private view?: vscode.WebviewView;
  private runCancel?: vscode.CancellationTokenSource;
  private pendingResume?: {
    resolve: (value: MitiiResumeInput | 'stop') => void;
  };
  private lastIndex: IndexStatusSnapshot = {
    fileCount: 0,
    truncated: false,
    message: 'Not indexed yet',
  };
  private ensureIndexedPromise?: Promise<IndexStatusSnapshot>;
  private discoveredModels: string[] = [];
  private connectionOk?: boolean;
  private connectionStatus?: string;
  /** Token usage scoped per chat thread (not global across chats). */
  private tokenUsageByThread = new Map<string, TokenUsageSnapshot>();
  private tokenUsage: TokenUsageSnapshot = emptyTokenUsage();
  private pendingRunTurns: TokenUsageSnapshot['turns'] = [];
  private runBaseTurns: TokenUsageSnapshot['turns'] = [];
  private runBaseInputTokens = 0;
  private runBaseOutputTokens = 0;
  private hostHelpers?: SidebarHostHelpers;
  private lastAssistantText = '';
  private activeThreadId?: string;
  private lastSuspensionRunId?: string;
  /** Per-run file mutation snapshots for undo / diff preview. */
  private fileChangeSnapshots = new Map<string, FileChangeRunSnapshot>();
  private activeFileChangeSnapshot?: FileChangeRunSnapshot;

  constructor(
    private readonly vs: typeof vscode,
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: () => Promise<MitiiClient>,
    private readonly getWorkspaceRoot: () => string | undefined,
    private readonly getWorkspaceId: () => string,
    private readonly channel: vscode.OutputChannel,
    private readonly secrets: vscode.SecretStorage,
    private readonly invalidateClient: () => void,
    private readonly onIndexWorkspace: () => Promise<IndexStatusSnapshot>,
    private readonly host: SidebarHostOptions,
  ) {
    const history = loadHistory(host.workspaceState);
    this.activeThreadId = history.activeThreadId;
  }

  attachHostHelpers(helpers: SidebarHostHelpers): void {
    this.hostHelpers = helpers;
  }

  resolveInlineDiffDecision(
    approvalId: string,
    decision: 'approved' | 'denied',
  ): void {
    this.host.onInlineDiffPending(false);
    if (!this.pendingResume || !this.lastSuspensionRunId) return;
    const runId = this.lastSuspensionRunId;
    const { resolve } = this.pendingResume;
    this.pendingResume = undefined;
    this.lastSuspensionRunId = undefined;
    this.post({ type: 'run.resumed', runId });
    resolve({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId,
      approval: { approvalId, decision },
    });
  }

  async readIndexStatusPublic(): Promise<IndexStatusSnapshot> {
    return this.readIndexStatus();
  }

  /**
   * Rehydrate in-memory repository state after Extension Host / client restart.
   * Disk cache alone is not enough — publish uses InMemoryRepositoryStateStore.
   */
  async ensureIndexed(): Promise<IndexStatusSnapshot> {
    if (this.ensureIndexedPromise) {
      return this.ensureIndexedPromise;
    }
    this.ensureIndexedPromise = this.ensureIndexedInner();
    try {
      return await this.ensureIndexedPromise;
    } finally {
      this.ensureIndexedPromise = undefined;
    }
  }

  postTrustAndNotices(notice: WorkspaceNoticeView): void {
    this.post({ type: 'workspaceNotice', notice });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.vs.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        this.vs.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    webview.html = this.renderHtml(webview);
    webview.onDidReceiveMessage((message) => {
      void this.onMessage(message as WebviewToHostMessage);
    });
  }

  async reveal(): Promise<void> {
    await this.vs.commands.executeCommand('mitii.sidebar.focus');
  }

  async refreshBootstrap(): Promise<void> {
    await this.sendBootstrap();
  }

  post(message: HostToWebviewMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private async onMessage(message: WebviewToHostMessage): Promise<void> {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'ready': {
        // Post a quick bootstrap first, then index so the UI is not blank.
        await this.sendBootstrap();
        const indexed = await this.ensureIndexed();
        this.post({ type: 'index.status', index: indexed });
        return;
      }
      case 'ask':
        await this.handleAsk(message);
        return;
      case 'cancel':
        this.runCancel?.cancel();
        return;
      case 'resume':
        this.handleResume(message);
        return;
      case 'navigate':
      case 'setTab':
        return;
      case 'newChat': {
        this.activeThreadId = newThreadId();
        const store = loadHistory(this.host.workspaceState);
        store.activeThreadId = this.activeThreadId;
        store.threads.unshift({
          id: this.activeThreadId,
          title: 'New chat',
          updatedAt: new Date().toISOString(),
          messages: [],
        });
        await saveHistory(this.host.workspaceState, store);
        this.setActiveThreadUsage(emptyTokenUsage(resolveContextWindow(this.vs)));
        this.post({
          type: 'history',
          threads: toThreadSummaries(store),
          activeThreadId: this.activeThreadId,
        });
        this.post({
          type: 'thread.loaded',
          threadId: this.activeThreadId,
          messages: [],
        });
        this.post({ type: 'tokenUsage', usage: this.tokenUsage });
        return;
      }
      case 'openChatThread': {
        const store = loadHistory(this.host.workspaceState);
        const thread = store.threads.find((t) => t.id === message.id);
        if (!thread) return;
        this.activeThreadId = thread.id;
        store.activeThreadId = thread.id;
        await saveHistory(this.host.workspaceState, store);
        this.setActiveThreadUsage(
          this.tokenUsageByThread.get(thread.id) ??
            emptyTokenUsage(resolveContextWindow(this.vs)),
        );
        this.post({
          type: 'thread.loaded',
          threadId: thread.id,
          messages: thread.messages,
        });
        this.post({
          type: 'history',
          threads: toThreadSummaries(store),
          activeThreadId: thread.id,
        });
        this.post({ type: 'tokenUsage', usage: this.tokenUsage });
        return;
      }
      case 'deleteChatThread': {
        const store = await deleteThread(this.host.workspaceState, message.id);
        this.tokenUsageByThread.delete(message.id);
        this.activeThreadId = store.activeThreadId;
        if (this.activeThreadId) {
          this.setActiveThreadUsage(
            this.tokenUsageByThread.get(this.activeThreadId) ??
              emptyTokenUsage(resolveContextWindow(this.vs)),
          );
        } else {
          this.setActiveThreadUsage(
            emptyTokenUsage(resolveContextWindow(this.vs)),
          );
        }
        this.post({
          type: 'history',
          threads: toThreadSummaries(store),
          activeThreadId: store.activeThreadId,
        });
        this.post({ type: 'tokenUsage', usage: this.tokenUsage });
        return;
      }
      case 'clearChatHistory': {
        await clearHistory(this.host.workspaceState);
        this.activeThreadId = undefined;
        this.tokenUsageByThread.clear();
        this.setActiveThreadUsage(
          emptyTokenUsage(resolveContextWindow(this.vs)),
        );
        this.post({
          type: 'history',
          threads: [],
          activeThreadId: undefined,
        });
        this.post({ type: 'tokenUsage', usage: this.tokenUsage });
        return;
      }
      case 'completeOnboarding': {
        await this.vs.workspace
          .getConfiguration('mitii')
          .update(
            'onboarding.completed',
            true,
            this.vs.ConfigurationTarget.Workspace,
          );
        this.post({ type: 'onboarding', required: false });
        return;
      }
      case 'showInlineDiff': {
        await this.showInlineDiffForApproval(message.approvalId);
        return;
      }
      case 'openDiffPreview': {
        const root = this.effectiveRoot();
        if (!root) return;
        if (message.oldText !== undefined && message.proposedText !== undefined) {
          await showPatchDiffPreview(
            this.vs,
            root,
            message.path,
            message.oldText,
            message.proposedText,
          );
        } else if (message.proposedText !== undefined) {
          await (this.hostHelpers?.showWriteDiffPreview(
            message.path,
            message.proposedText,
          ) ??
            showWriteDiffPreview(
              this.vs,
              root,
              message.path,
              message.proposedText,
            ));
        }
        return;
      }
      case 'toggleContextSource': {
        await this.vs.workspace
          .getConfiguration('mitii')
          .update(
            `ui.contextToggles.${message.source}`,
            message.enabled,
            this.vs.ConfigurationTarget.Workspace,
          );
        if (message.source === 'memory') {
          this.invalidateClient();
        }
        await this.sendBootstrap();
        return;
      }
      case 'refreshReviewDiff': {
        const root = this.effectiveRoot();
        if (!root) {
          this.post({
            type: 'setReviewDiff',
            review: { summary: 'No workspace', files: [] },
          });
          return;
        }
        this.post({
          type: 'setReviewDiff',
          review: await buildReviewDiff(root),
        });
        return;
      }
      case 'restoreCheckpoint': {
        void this.vs.window.showInformationMessage(
          `Mitii: Checkpoint restore for ${message.id} is recorded. Full V8 restore lands when checkpoint APIs are exposed on the SDK.`,
        );
        return;
      }
      case 'deleteCheckpoint': {
        const checkpoints = loadCheckpoints(this.host.workspaceState).filter(
          (c) => c.id !== message.id,
        );
        await saveCheckpoints(this.host.workspaceState, checkpoints);
        this.post({ type: 'setCheckpoints', checkpoints });
        return;
      }
      case 'clearCheckpoints': {
        await saveCheckpoints(this.host.workspaceState, []);
        this.post({ type: 'setCheckpoints', checkpoints: [] });
        return;
      }
      case 'addMemory': {
        try {
          const items = await commitMemoryForWorkspace(
            this.host.workspaceState,
            this.getWorkspaceId(),
            message.text,
          );
          this.post({ type: 'setMemories', memories: items });
        } catch (error) {
          this.post({
            type: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Failed to save memory.',
          });
        }
        return;
      }
      case 'deleteMemory': {
        const items = await deleteMemoryForWorkspace(
          this.host.workspaceState,
          this.getWorkspaceId(),
          message.id,
        );
        this.post({ type: 'setMemories', memories: items });
        return;
      }
      case 'clearMemory': {
        await clearMemoriesForWorkspace(
          this.host.workspaceState,
          this.getWorkspaceId(),
        );
        this.post({ type: 'setMemories', memories: [] });
        return;
      }
      case 'requestSkillCatalog': {
        const q = (message.query ?? '').toLowerCase();
        const catalog = await loadDiskSkills({
          workspaceRoot: this.getWorkspaceRoot(),
          contentMode: 'metadata',
        });
        const items = catalog
          .filter((skill: SkillDescriptor) => {
            return (
              !q ||
              skill.id.toLowerCase().includes(q) ||
              skill.title.toLowerCase().includes(q)
            );
          })
          .map((skill: SkillDescriptor) => ({
            id: skill.id,
            name: skill.title,
            description: skill.content.slice(0, 160),
            enabled: true,
          }));
        this.post({
          type: 'skillCatalogResult',
          requestId: message.requestId,
          items,
        });
        return;
      }
      case 'pickContextPath': {
        const picked = await this.vs.window.showOpenDialog({
          canSelectMany: true,
          openLabel: 'Pin to Mitii context',
        });
        if (!picked?.length) return;
        const root = this.effectiveRoot();
        for (const uri of picked) {
          let rel = uri.fsPath;
          if (root && rel.startsWith(root)) {
            rel = rel.slice(root.length).replace(/^[\\/]/, '');
          }
          this.post({ type: 'editorPin', path: rel.replace(/\\/g, '/'), source: 'user' });
        }
        return;
      }
      case 'copyLastResponse': {
        if (this.lastAssistantText) {
          await this.vs.env.clipboard.writeText(this.lastAssistantText);
          void this.vs.window.showInformationMessage(
            'Mitii: Last response copied.',
          );
        }
        return;
      }
      case 'approveAllPending': {
        if (this.pendingResume) {
          // Webview should send explicit resume; this is a no-op hint
          void this.vs.window.showInformationMessage(
            'Use the approval card to approve or deny.',
          );
        }
        return;
      }
      case 'settings.get':
        await this.sendBootstrap();
        return;
      case 'settings.set':
        await this.handleSettingsSet(message);
        return;
      case 'settings.setApiKey':
        await this.vs.commands.executeCommand('mitii.setApiKey');
        await this.sendBootstrap();
        return;
      case 'settings.clearApiKey':
        await this.vs.commands.executeCommand('mitii.clearApiKey');
        await this.sendBootstrap();
        return;
      case 'provider.testConnection':
        await this.handleTestConnection(message);
        return;
      case 'index.refresh':
        this.post({ type: 'index.status', index: await this.readIndexStatus() });
        return;
      case 'index.reindex': {
        this.post({
          type: 'index.status',
          index: {
            ...this.lastIndex,
            message: 'Indexing workspace…',
            readiness: 'indexing',
          },
        });
        const index = await this.onIndexWorkspace();
        this.lastIndex = index;
        this.post({ type: 'index.status', index });
        return;
      }
      case 'paths.search': {
        const root = this.effectiveRoot();
        const suggestions = root
          ? await searchWorkspacePaths(root, message.query)
          : [];
        this.post({
          type: 'paths.results',
          requestId: message.requestId,
          suggestions,
        });
        return;
      }
      case 'openFolder':
        await this.vs.commands.executeCommand('vscode.openFolder');
        return;
      case 'openFile': {
        await this.openWorkspaceFile(
          message.path,
          message.line,
          message.column,
        );
        return;
      }
      case 'undoFileChanges': {
        await this.handleUndoFileChanges(message.runId);
        return;
      }
      case 'reviewFileChange': {
        await this.handleReviewFileChange(message.runId, message.path);
        return;
      }
      case 'dismissFileChanges': {
        this.fileChangeSnapshots.delete(message.runId);
        return;
      }
      default:
        return;
    }
  }

  private async openWorkspaceFile(
    relPath: string,
    line?: number,
    column?: number,
  ): Promise<void> {
    const root = this.effectiveRoot();
    if (!root) {
      this.post({ type: 'error', message: 'No workspace folder open.' });
      return;
    }
    const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const abs = join(root, normalized);
    if (!existsSync(abs)) {
      this.post({
        type: 'error',
        message: `File not found: ${normalized}`,
      });
      return;
    }
    const uri = this.vs.Uri.file(abs);
    const doc = await this.vs.workspace.openTextDocument(uri);
    const editor = await this.vs.window.showTextDocument(doc, {
      preview: true,
    });
    if (line && line > 0) {
      const pos = new this.vs.Position(
        Math.max(0, line - 1),
        Math.max(0, (column ?? 1) - 1),
      );
      editor.selection = new this.vs.Selection(pos, pos);
      editor.revealRange(
        new this.vs.Range(pos, pos),
        this.vs.TextEditorRevealType.InCenter,
      );
    }
  }

  private async handleUndoFileChanges(runId: string): Promise<void> {
    const root = this.effectiveRoot();
    const snapshot = this.fileChangeSnapshots.get(runId);
    if (!root || !snapshot) {
      this.post({
        type: 'error',
        message: 'Nothing to undo for this run.',
      });
      return;
    }
    const result = undoRunFileChanges({ workspaceRoot: root, snapshot });
    this.channel.appendLine(
      `[file-changes] undo run=${runId} restored=${result.restored.length} failed=${result.failed.length}`,
    );
    if (result.failed.length === 0) {
      this.fileChangeSnapshots.delete(runId);
    }
    this.post({
      type: 'fileChanges.undone',
      runId,
      restored: result.restored,
    });
    if (result.failed.length) {
      this.post({
        type: 'error',
        message: `Undo partially failed: ${result.failed
          .map((f) => f.path)
          .join(', ')}`,
      });
    } else {
      void this.vs.window.showInformationMessage(
        `Mitii: Reverted ${result.restored.length} file${
          result.restored.length === 1 ? '' : 's'
        } from this run.`,
      );
    }
  }

  private async handleReviewFileChange(
    runId: string,
    path: string,
  ): Promise<void> {
    const root = this.effectiveRoot();
    const snapshot = this.fileChangeSnapshots.get(runId);
    if (!root || !snapshot) return;
    const normalized = path.replace(/\\/g, '/');
    const before = snapshot.beforeContents.has(normalized)
      ? (snapshot.beforeContents.get(normalized) ?? null)
      : null;
    const abs = join(root, normalized);
    let after = '';
    try {
      after = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    } catch {
      after = '';
    }
    await showPatchDiffPreview(
      this.vs,
      root,
      normalized,
      before ?? '',
      after,
    );
  }

  private async showInlineDiffForApproval(approvalId: string): Promise<void> {
    const pending = this.host.inlineDiff.getPending();
    if (pending && pending.approvalId === approvalId) {
      const root = this.effectiveRoot();
      if (!root) return;
      await this.host.inlineDiff.showForApproval(
        root,
        pending.approvalId,
        pending.relPath,
        pending.toolName,
        pending.proposedText,
        pending.originalText,
      );
      this.host.onInlineDiffPending(true);
      return;
    }
    void this.vs.window.showInformationMessage(
      'No pending inline diff for that approval. Approve from the card, or wait for a file mutation approval.',
    );
  }

  private handleResume(
    message: Extract<WebviewToHostMessage, { type: 'resume' }>,
  ): void {
    if (!this.pendingResume) return;
    const { resolve } = this.pendingResume;
    this.pendingResume = undefined;
    if (message.clarificationAnswer?.trim()) {
      this.post({ type: 'run.resumed', runId: message.runId });
      this.lastSuspensionRunId = undefined;
      resolve({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: message.runId,
        clarificationAnswer: message.clarificationAnswer.trim(),
      });
      return;
    }
    if (message.approval) {
      this.host.inlineDiff.setPending(undefined);
      this.host.onInlineDiffPending(false);
      this.post({ type: 'run.resumed', runId: message.runId });
      this.lastSuspensionRunId = undefined;
      resolve({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: message.runId,
        approval: message.approval,
      });
      return;
    }
    if (message.planDecision) {
      this.post({ type: 'run.resumed', runId: message.runId });
      this.lastSuspensionRunId = undefined;
      resolve({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: message.runId,
        planDecision: message.planDecision,
      });
      return;
    }
    resolve('stop');
  }

  private mcpRuntimeStatus(): McpRuntimeStatus {
    const mcp = readMcpSettings(this.vs, this.effectiveRoot());
    if (!mcp.enabled) return 'disabled';
    const active = mcp.servers.filter((s) =>
      typeof s.enabled === 'boolean' ? s.enabled : !s.disabled,
    );
    if (active.length === 0) return 'configured';

    const snapshot = getSharedMcpManager().snapshot();
    if (!snapshot.enabled) return 'disabled';
    const ready = snapshot.servers.filter((s) => s.status === 'ready').length;
    const errored = snapshot.servers.filter((s) => s.status === 'error').length;
    if (ready > 0 && errored === 0) return 'ready';
    if (ready > 0 && errored > 0) return 'partial';
    if (errored > 0) return 'error';
    if (snapshot.toolDefinitions.length > 0) return 'ready';
    return 'configured';
  }

  private async handleAsk(
    message: Extract<WebviewToHostMessage, { type: 'ask' }>,
  ): Promise<void> {
    const prompt = String(message.prompt ?? '').trim();
    if (!prompt) return;
    const activeThread = await this.ensureActiveThread(prompt);
    const conversation = buildConversationCarry({
      messages: (activeThread?.messages ?? []).map((m) => ({
        role: m.role,
        text: m.text,
      })),
      currentPrompt: prompt,
    });
    const conversationText = conversation
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');
    this.runCancel?.dispose();
    this.runCancel = new this.vs.CancellationTokenSource();
    const mode = message.mode === 'review' ? 'ask' : (message.mode ?? 'ask');
    const llmPrompt =
      message.mode === 'review'
        ? `Review the current git changes and suggest improvements / risks.\n\n${prompt}`
        : prompt;
    if (message.mode === 'review') {
      const root = this.effectiveRoot();
      if (root) {
        this.post({
          type: 'setReviewDiff',
          review: await buildReviewDiff(root),
        });
      }
    }
    this.post({ type: 'run.started', mode: message.mode, prompt });
    this.pendingRunTurns = [];
    this.runBaseTurns = [...(this.tokenUsage.turns ?? [])];
    this.runBaseInputTokens = this.tokenUsage.inputTokensTotal;
    this.runBaseOutputTokens = this.tokenUsage.outputTokensTotal;
    const contextWindow = resolveContextWindow(this.vs);
    const toggles = readContextToggles(this.vs);
    const memoryBlock = toggles.memory
      ? await estimateMemoryPromptBlock(
          this.host.workspaceState,
          this.getWorkspaceId(),
        )
      : undefined;
    const provisionalContextBreakdown = buildContextUsageBreakdown({
      prompt: llmPrompt,
      conversationText,
      memoryBlock,
      depthHint: message.depth,
      contextWindow,
    });
    this.post({
      type: 'tokenUsage',
      usage: {
        ...this.tokenUsage,
        currentTurnTotal: provisionalContextBreakdown.totalTokens,
        currentTurnInputTokens: provisionalContextBreakdown.totalTokens,
        currentTurnOutputTokens: 0,
        lastPromptTokens: provisionalContextBreakdown.totalTokens,
        lastResponseTokens: 0,
        contextWindow,
        contextBreakdown: provisionalContextBreakdown,
        estimated: true,
        live: true,
      },
    });

    const workspaceRootForChanges = this.effectiveRoot();
    const preDirty = workspaceRootForChanges
      ? await listDirtyGitPaths(workspaceRootForChanges)
      : [];
    this.activeFileChangeSnapshot = createFileChangeRunSnapshot(preDirty);

    try {
      const client = await this.ensureClient();
      const engineMode =
        mode === 'plan' || mode === 'agent' ? mode : 'ask';
      const approvedPlan = resolvePlanHandoff({
        mode: engineMode,
        pendingPlan: activeThread?.pendingPlan,
      });

      const outcome = await runAskInOutputChannel({
        vs: this.vs,
        client,
        prompt: llmPrompt,
        workspaceRoot: this.effectiveRoot(),
        channel: this.channel,
        mode: engineMode,
        depth: message.depth,
        pinnedPaths: message.pinnedPaths,
        workspaceId: this.getWorkspaceId(),
        workspaceState: this.host.workspaceState,
        secrets: this.secrets,
        sessionId: this.activeThreadId,
        conversationText,
        conversation,
        approvedPlan,
        handlers: {
          cancelToken: this.runCancel.token,
          onContextBreakdown: (breakdown) => {
            this.tokenUsage = {
              ...this.tokenUsage,
              contextBreakdown: breakdown,
              contextWindow: breakdown.contextWindow,
              live: true,
            };
            this.post({ type: 'tokenUsage', usage: this.tokenUsage });
          },
          onEvent: (event, activity) => {
            this.post({ type: 'run.event', event: activity });
            const changeRoot = this.effectiveRoot();
            if (changeRoot && this.activeFileChangeSnapshot && event) {
              noteMutatedPathsFromEvent(
                this.activeFileChangeSnapshot,
                changeRoot,
                event,
              );
            }
            if (event?.type === 'model_turn') {
              this.recordLiveModelTurn(event);
              this.post({ type: 'tokenUsage', usage: this.tokenUsage });
            }
          },
          onDelta: (text) => {
            this.post({ type: 'run.delta', text });
          },
          onSuspended: async (_result, suspension) => {
            if (
              suspension.kind === 'approval_required' &&
              suspension.approval?.paths?.length &&
              this.activeFileChangeSnapshot
            ) {
              const changeRoot = this.effectiveRoot();
              if (changeRoot) {
                noteMutatedPaths(
                  this.activeFileChangeSnapshot,
                  changeRoot,
                  suspension.approval.paths,
                );
              }
            }
            if (
              suspension.kind === 'approval_required' &&
              suspension.approval?.paths?.[0]
            ) {
              const root = this.effectiveRoot();
              const relPath = suspension.approval.paths[0];
              if (root) {
                // Best-effort: show path in inline manager with empty proposed until webview opens preview
                await this.host.inlineDiff.showForApproval(
                  root,
                  suspension.approval.approvalId,
                  relPath,
                  suspension.approval.toolName,
                  suspension.approval.proposedText ??
                    `(pending ${suspension.approval.toolName} on ${relPath})`,
                );
                this.host.onInlineDiffPending(true);
              }
            }
            if (
              suspension.kind === 'plan_approval_required' &&
              suspension.plan
            ) {
              this.post({ type: 'setPlan', plan: suspension.plan });
              const root = this.effectiveRoot();
              if (root) {
                try {
                  const saved = savePlanToWorkspace({
                    workspaceRoot: root,
                    plan: suspension.plan,
                    source: 'plan_approval',
                    threadId: this.activeThreadId,
                  });
                  this.channel.appendLine(`[plan] saved ${saved.relativePath}`);
                } catch (error) {
                  this.channel.appendLine(
                    `[plan] save failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              }
            }
            this.lastSuspensionRunId = suspension.runId;
            this.post({ type: 'run.suspended', suspension });
            return new Promise<MitiiResumeInput | 'stop'>((resolve) => {
              this.pendingResume = { resolve };
            });
          },
        },
      });
      if (outcome.result.status === 'cancelled') {
        this.post({ type: 'run.cancelled' });
      }
      const usage = this.recordUsage(
        outcome.result,
        llmPrompt,
        outcome.contextBreakdown,
      );
      const answer = outcome.result.answer ?? '';
      const assistantText = answer.trim()
        ? answer
        : outcome.result.error?.message
          ? `Error: ${outcome.result.error.message}`
          : `(${outcome.result.status})`;
      this.lastAssistantText = assistantText;
      const resultPlan = outcome.result.plan;
      const plan =
        message.mode === 'plan'
          ? planViewFromArtifact(resultPlan) ??
            this.planFromAnswer(message.mode, answer)
          : approvedPlan
            ? planViewFromArtifact(approvedPlan)
            : null;
      this.post({
        type: 'run.result',
        status: outcome.result.status,
        answer: assistantText,
        route: outcome.result.route ?? null,
        error: outcome.result.error?.message,
        usage,
        plan,
      });

      const changeRoot = this.effectiveRoot();
      const runId = outcome.result.runId;
      if (
        changeRoot &&
        this.activeFileChangeSnapshot &&
        runId &&
        this.activeFileChangeSnapshot.mutatedPaths.size > 0
      ) {
        this.fileChangeSnapshots.set(runId, this.activeFileChangeSnapshot);
        const changes = buildRunFileChangesView({
          runId,
          workspaceRoot: changeRoot,
          snapshot: this.activeFileChangeSnapshot,
        });
        if (changes) {
          this.post({ type: 'run.fileChanges', changes });
          this.channel.appendLine(
            `[file-changes] run=${runId} status=${outcome.result.status} files=${changes.files.length} +${changes.totalAdditions} -${changes.totalDeletions}`,
          );
        }
      }
      this.activeFileChangeSnapshot = undefined;

      this.post({ type: 'tokenUsage', usage: this.tokenUsage });
      const usedPlanHandoff = Boolean(approvedPlan);
      if (resultPlan) {
        const root = this.effectiveRoot();
        if (root) {
          try {
            const saved = savePlanToWorkspace({
              workspaceRoot: root,
              plan: resultPlan,
              source:
                message.mode === 'plan'
                  ? 'plan_mode'
                  : approvedPlan
                    ? 'plan_approval'
                    : 'agent',
              threadId: this.activeThreadId,
            });
            this.channel.appendLine(
              `[plan] saved ${saved.relativePath}`,
            );
          } catch (error) {
            this.channel.appendLine(
              `[plan] save failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      const store = await appendTurn(this.host.workspaceState, {
        threadId: this.activeThreadId,
        userText: prompt,
        assistantText,
        mode: message.mode,
        ...(message.mode === 'plan' && resultPlan
          ? { pendingPlan: resultPlan }
          : {}),
        ...(usedPlanHandoff && outcome.result.status === 'completed'
          ? { clearPendingPlan: true }
          : {}),
      });
      this.activeThreadId = store.activeThreadId;
      this.post({
        type: 'history',
        threads: toThreadSummaries(store),
        activeThreadId: store.activeThreadId,
      });
      // Snapshot a checkpoint label after successful runs
      if (outcome.result.status === 'completed') {
        const checkpoints = loadCheckpoints(this.host.workspaceState);
        checkpoints.unshift({
          id: `cp_${Date.now().toString(36)}`,
          label: `After: ${prompt.slice(0, 40)}`,
          createdAt: new Date().toISOString(),
        });
        await saveCheckpoints(this.host.workspaceState, checkpoints.slice(0, 30));
        this.post({ type: 'setCheckpoints', checkpoints: checkpoints.slice(0, 30) });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const assistantText = `Error: ${text}`;
      this.lastAssistantText = assistantText;
      this.post({ type: 'error', message: text });
      this.post({
        type: 'run.result',
        status: 'failed',
        answer: assistantText,
        error: text,
      });
      const store = await appendTurn(this.host.workspaceState, {
        threadId: this.activeThreadId,
        userText: prompt,
        assistantText,
        mode: message.mode,
      });
      this.activeThreadId = store.activeThreadId;
      this.post({
        type: 'history',
        threads: toThreadSummaries(store),
        activeThreadId: store.activeThreadId,
      });
    } finally {
      this.activeFileChangeSnapshot = undefined;
      this.runCancel?.dispose();
      this.runCancel = undefined;
      if (this.pendingResume) {
        this.pendingResume.resolve('stop');
        this.pendingResume = undefined;
      }
    }
  }

  private async ensureActiveThread(prompt: string): Promise<StoredThread> {
    const store = loadHistory(this.host.workspaceState);
    let thread = this.activeThreadId
      ? store.threads.find((t) => t.id === this.activeThreadId)
      : undefined;
    thread ??= store.activeThreadId
      ? store.threads.find((t) => t.id === store.activeThreadId)
      : undefined;
    if (!thread) {
      thread = {
        id: newThreadId(),
        title: prompt.slice(0, 48) || 'New chat',
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      store.threads.unshift(thread);
    }
    this.activeThreadId = thread.id;
    store.activeThreadId = thread.id;
    await saveHistory(this.host.workspaceState, store);
    this.post({
      type: 'history',
      threads: toThreadSummaries(store),
      activeThreadId: thread.id,
    });
    return thread;
  }

  private planFromAnswer(
    mode: string | undefined,
    answer: string,
  ): PlanView | null {
    if (mode !== 'plan' || !answer.trim()) return null;
    const lines = answer
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[-*\d.]/.test(l))
      .slice(0, 12);
    if (!lines.length) {
      return {
        title: 'Plan',
        steps: [
          {
            id: 'step_1',
            title: 'See assistant reply for plan details',
            status: 'pending',
          },
        ],
      };
    }
    return {
      title: 'Plan',
      steps: lines.map((title, i) => ({
        id: `step_${i + 1}`,
        title: title.replace(/^[-*\d.)\s]+/, '').slice(0, 120),
        status: i === 0 ? 'active' : 'pending',
      })),
    };
  }

  private async handleTestConnection(
    message: Extract<WebviewToHostMessage, { type: 'provider.testConnection' }>,
  ): Promise<void> {
    this.post({
      type: 'provider.connectionResult',
      ok: false,
      message: 'Testing…',
      testing: true,
    });
    const apiKey =
      (await this.secrets.get('mitii.provider.apiKey')) ??
      process.env.MITII_API_KEY ??
      process.env.OPENAI_API_KEY;
    const result = await testProviderConnection({
      type: message.provider.type,
      baseUrl: message.provider.baseUrl,
      model: message.provider.model,
      apiKey,
    });
    this.connectionOk = result.ok;
    this.connectionStatus = result.message;
    if (result.models?.length) {
      this.discoveredModels = result.models;
    }
    this.post({
      type: 'provider.connectionResult',
      ok: result.ok,
      message: result.message,
      models: result.models,
      testing: false,
    });
    await this.sendBootstrap();
  }

  private recordLiveModelTurn(event: {
    turnIndex: number;
    at: string;
    inputTokens?: number;
    outputTokens?: number;
    finishReason?: string;
    truncated?: boolean;
  }): void {
    const input = event.inputTokens ?? 0;
    const output = event.outputTokens ?? 0;
    const estimated =
      event.inputTokens === undefined && event.outputTokens === undefined;
    this.pendingRunTurns = [
      ...this.pendingRunTurns,
      {
        turnIndex: event.turnIndex,
        at: event.at,
        inputTokens: input,
        outputTokens: output,
        finishReason: event.finishReason,
        truncated: event.truncated,
        estimated,
      },
    ];
    const pendingInput = this.pendingRunTurns.reduce(
      (sum, t) => sum + t.inputTokens,
      0,
    );
    const pendingOutput = this.pendingRunTurns.reduce(
      (sum, t) => sum + t.outputTokens,
      0,
    );
    const last = this.pendingRunTurns[this.pendingRunTurns.length - 1]!;
    this.tokenUsage = {
      ...this.tokenUsage,
      inputTokensTotal: this.runBaseInputTokens + pendingInput,
      outputTokensTotal: this.runBaseOutputTokens + pendingOutput,
      sessionTotal:
        this.runBaseInputTokens +
        this.runBaseOutputTokens +
        pendingInput +
        pendingOutput,
      currentTurnTotal: pendingInput + pendingOutput,
      currentTurnInputTokens: last.inputTokens,
      currentTurnOutputTokens: last.outputTokens,
      lastPromptTokens: last.inputTokens,
      lastResponseTokens: last.outputTokens,
      contextWindow: resolveContextWindow(this.vs),
      turns: [...this.runBaseTurns, ...this.pendingRunTurns].slice(-40),
      live: true,
    };
    this.persistThreadUsage();
  }

  private recordUsage(result: {
    usage: {
      modelCalls: number;
      toolCalls: number;
      loopIterations: number;
      inputTokens?: number;
      outputTokens?: number;
    };
    durationMs: number;
    answer?: string;
  }, prompt = '', contextBreakdown?: import('./protocol.js').ContextUsageBreakdown): RunUsagePayload {
    const pending = this.pendingRunTurns;
    this.pendingRunTurns = [];
    const pendingInput = pending.reduce((sum, t) => sum + t.inputTokens, 0);
    const pendingOutput = pending.reduce((sum, t) => sum + t.outputTokens, 0);

    let input = result.usage.inputTokens;
    let output = result.usage.outputTokens;
    const missingProviderTokens =
      (input === undefined || input === 0) &&
      (output === undefined || output === 0) &&
      result.usage.modelCalls > 0;
    let estimated =
      input === undefined || output === undefined || missingProviderTokens;

    if (pending.length > 0 && (pendingInput > 0 || pendingOutput > 0)) {
      input = pendingInput;
      output = pendingOutput;
      estimated = pending.some((t) => t.estimated) || estimated;
    } else {
      if (input === undefined || (missingProviderTokens && (input ?? 0) === 0)) {
        input = Math.max(1, Math.ceil(prompt.length / 4));
      }
      if (
        output === undefined ||
        (missingProviderTokens && (output ?? 0) === 0)
      ) {
        output = Math.max(0, Math.ceil((result.answer ?? '').length / 4));
      }
    }

    const turnTotal = input + output;
    const preset = findLocalModelPreset(
      this.vs.workspace.getConfiguration('mitii').get<string>('provider.model') ??
        '',
    );
    const contextWindow =
      preset?.contextWindow ?? resolveContextWindow(this.vs);

    const committedTurns =
      pending.length > 0
        ? pending
        : [
            {
              turnIndex: this.tokenUsage.modelCalls,
              at: new Date().toISOString(),
              inputTokens: input,
              outputTokens: output,
              estimated,
            },
          ];

    // Drop provisional live appends (session turns + pending), then commit once.
    const baseTurns = this.runBaseTurns;
    const baseInput = this.runBaseInputTokens;
    const baseOutput = this.runBaseOutputTokens;
    this.runBaseTurns = [];

    this.tokenUsage = {
      ...this.tokenUsage,
      inputTokensTotal: baseInput + input,
      outputTokensTotal: baseOutput + output,
      sessionTotal: baseInput + baseOutput + input + output,
      currentTurnTotal: turnTotal,
      currentTurnInputTokens: input,
      currentTurnOutputTokens: output,
      aiCallCount: this.tokenUsage.aiCallCount + result.usage.modelCalls,
      modelCalls: this.tokenUsage.modelCalls + result.usage.modelCalls,
      toolCalls: this.tokenUsage.toolCalls + result.usage.toolCalls,
      loopIterations:
        this.tokenUsage.loopIterations + result.usage.loopIterations,
      lastPromptTokens: input,
      lastResponseTokens: output,
      turnCount: this.tokenUsage.turnCount + 1,
      contextWindow,
      estimated,
      durationMs: result.durationMs,
      turns: [...baseTurns, ...committedTurns].slice(-40),
      live: false,
      contextBreakdown:
        contextBreakdown ?? this.tokenUsage.contextBreakdown,
    };
    this.persistThreadUsage();
    return {
      modelCalls: result.usage.modelCalls,
      toolCalls: result.usage.toolCalls,
      loopIterations: result.usage.loopIterations,
      inputTokens: input,
      outputTokens: output,
      durationMs: result.durationMs,
    };
  }

  private async handleSettingsSet(
    message: Extract<WebviewToHostMessage, { type: 'settings.set' }>,
  ): Promise<void> {
    const cfg = this.vs.workspace.getConfiguration('mitii');
    if (message.provider) {
      if (message.provider.type !== undefined) {
        await cfg.update(
          'provider.type',
          message.provider.type,
          this.vs.ConfigurationTarget.Workspace,
        );
      }
      if (message.provider.preset !== undefined) {
        await cfg.update(
          'provider.preset',
          message.provider.preset,
          this.vs.ConfigurationTarget.Workspace,
        );
      }
      if (message.provider.baseUrl !== undefined) {
        await cfg.update(
          'provider.baseUrl',
          message.provider.baseUrl,
          this.vs.ConfigurationTarget.Workspace,
        );
      }
      if (message.provider.model !== undefined) {
        await cfg.update(
          'provider.model',
          message.provider.model,
          this.vs.ConfigurationTarget.Workspace,
        );
      }
      if (message.provider.contextWindow !== undefined) {
        const window = Math.max(
          1024,
          Math.floor(Number(message.provider.contextWindow) || 0),
        );
        await cfg.update(
          'provider.contextWindow',
          window,
          this.vs.ConfigurationTarget.Workspace,
        );
      }
      if (message.provider.maximumOutputTokens !== undefined) {
        const maxOut = Math.max(
          256,
          Math.floor(Number(message.provider.maximumOutputTokens) || 0),
        );
        await cfg.update(
          'provider.maximumOutputTokens',
          maxOut,
          this.vs.ConfigurationTarget.Workspace,
        );
      }
      this.connectionOk = undefined;
      this.connectionStatus = undefined;
      this.invalidateClient();
    }
    if (message.ui) {
      if (message.ui.showReasoning !== undefined) {
        await cfg.update(
          'ui.showReasoning',
          message.ui.showReasoning,
          this.vs.ConfigurationTarget.Global,
        );
      }
      if (message.ui.reasoningPreviewMaxChars !== undefined) {
        await cfg.update(
          'ui.reasoningPreviewMaxChars',
          message.ui.reasoningPreviewMaxChars,
          this.vs.ConfigurationTarget.Global,
        );
      }
      if (message.ui.depth !== undefined) {
        await cfg.update(
          'ui.depth',
          message.ui.depth,
          this.vs.ConfigurationTarget.Global,
        );
      }
      if (message.ui.runBudget) {
        if (message.ui.runBudget.unlimited !== undefined) {
          await cfg.update(
            'runBudget.unlimited',
            message.ui.runBudget.unlimited,
            this.vs.ConfigurationTarget.Workspace,
          );
        }
        const writeBudgetNumber = async (
          key: Exclude<keyof RunBudgetSettingsSnapshot, 'unlimited'>,
          setting: string,
          minimum: number,
        ) => {
          const value = message.ui?.runBudget?.[key];
          if (value === undefined) return;
          await cfg.update(
            setting,
            Math.max(minimum, Math.floor(Number(value) || 0)),
            this.vs.ConfigurationTarget.Workspace,
          );
        };
        await writeBudgetNumber('maxModelCalls', 'runBudget.maxModelCalls', 1);
        await writeBudgetNumber('maxToolCalls', 'runBudget.maxToolCalls', 1);
        await writeBudgetNumber(
          'maxLoopIterations',
          'runBudget.maxLoopIterations',
          1,
        );
        await writeBudgetNumber(
          'maxWallTimeMinutes',
          'runBudget.maxWallTimeMinutes',
          1,
        );
      }
      if (message.ui.contextToggles) {
        for (const [key, value] of Object.entries(message.ui.contextToggles)) {
          if (value === undefined) continue;
          await cfg.update(
            `ui.contextToggles.${key}`,
            value,
            this.vs.ConfigurationTarget.Workspace,
          );
        }
        if (message.ui.contextToggles.memory !== undefined) {
          this.invalidateClient();
        }
      }
    }
    if (message.approvalMode !== undefined) {
      await cfg.update(
        'safety.approvalMode',
        message.approvalMode,
        this.vs.ConfigurationTarget.Workspace,
      );
    }
    if (message.workspaceRootOverride !== undefined) {
      await cfg.update(
        'workspace.rootPathOverride',
        message.workspaceRootOverride,
        this.vs.ConfigurationTarget.Workspace,
      );
    }
    if (message.mcp) {
      await writeMcpSettings(this.vs, this.effectiveRoot(), message.mcp);
      this.invalidateClient();
    }
    await this.sendBootstrap();
  }

  private effectiveRoot(): string | undefined {
    const override = this.vs.workspace
      .getConfiguration('mitii')
      .get<string>('workspace.rootPathOverride')
      ?.trim();
    if (override) return override;
    return this.getWorkspaceRoot();
  }

  private buildAvailableModels(currentModel: string): string[] {
    const set = new Set<string>();
    if (currentModel.trim()) set.add(currentModel.trim());
    for (const preset of LOCAL_MODEL_PRESETS) set.add(preset.model);
    for (const id of this.discoveredModels) {
      if (id.trim()) set.add(id.trim());
    }
    return [...set];
  }

  private async readProvider(): Promise<ProviderSettingsSnapshot> {
    const cfg = this.vs.workspace.getConfiguration('mitii');
    const hasApiKey = Boolean(
      (await this.secrets.get('mitii.provider.apiKey')) ??
        process.env.MITII_API_KEY ??
        process.env.OPENAI_API_KEY,
    );
    const model = cfg.get<string>('provider.model') ?? 'qwen3-coder:30b';
    const contextWindow = resolveContextWindow(this.vs);
    const fromMaxOut = cfg.get<number>('provider.maximumOutputTokens');
    const maximumOutputTokens =
      typeof fromMaxOut === 'number' &&
      Number.isFinite(fromMaxOut) &&
      fromMaxOut > 0
        ? Math.floor(fromMaxOut)
        : Math.min(16_384, Math.max(1, contextWindow - 1));
    return {
      type: cfg.get<string>('provider.type') ?? 'echo',
      preset: cfg.get<string>('provider.preset') ?? undefined,
      baseUrl: cfg.get<string>('provider.baseUrl') ?? 'http://localhost:11434/v1',
      model,
      hasApiKey,
      availableModels: this.buildAvailableModels(model),
      contextWindow,
      maximumOutputTokens,
      connectionOk: this.connectionOk,
      connectionStatus: this.connectionStatus,
    };
  }

  private readUi(): UiSettingsSnapshot {
    const cfg = this.vs.workspace.getConfiguration('mitii');
    return {
      showReasoning: cfg.get<boolean>('ui.showReasoning') ?? true,
      reasoningPreviewMaxChars:
        cfg.get<number>('ui.reasoningPreviewMaxChars') ?? 8000,
      depth: (cfg.get<string>('ui.depth') as UiSettingsSnapshot['depth']) ?? 'auto',
      contextToggles: resolveContextToggles(cfg),
      approvalMode: cfg.get<string>('safety.approvalMode') ?? 'guided',
      runBudget: readRunBudgetSettings(this.vs),
    };
  }

  private readWorkspace(): WorkspaceSnapshotInfo {
    const root = this.getWorkspaceRoot();
    const rootOverride = this.vs.workspace
      .getConfiguration('mitii')
      .get<string>('workspace.rootPathOverride')
      ?.trim();
    return {
      root,
      rootOverride: rootOverride || undefined,
      displayRoot: rootOverride || root,
    };
  }

  private async ensureIndexedInner(): Promise<IndexStatusSnapshot> {
    const root = this.effectiveRoot();
    if (!root) {
      this.lastIndex = {
        fileCount: 0,
        truncated: false,
        message: 'Open a workspace folder to index',
      };
      return this.lastIndex;
    }

    try {
      const client = await this.ensureClient();
      const latest = await client.getLatestRepositoryState(this.getWorkspaceId());
      if (latest) {
        if (this.lastIndex.fileCount === 0) {
          await this.readIndexStatus();
        }
        const descriptorStatus = indexStatusFromDescriptor(latest);
        this.lastIndex = {
          ...this.lastIndex,
          ...descriptorStatus,
          message:
            this.lastIndex.fileCount > 0
              ? `Indexed ${this.lastIndex.fileCount} files`
              : (this.lastIndex.message ?? 'Repository state ready'),
        };
        if (needsFullIndexRefresh(this.lastIndex)) {
          this.channel.appendLine(
            '[index] cached state is missing full code/text/graph/map index; republishing full index…',
          );
          return await this.publishIndexSnapshot();
        }
        return this.lastIndex;
      }
    } catch (error) {
      this.channel.appendLine(
        `[index] latest-state check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.channel.appendLine('[index] first load: publishing host snapshot…');
    this.post({
      type: 'index.status',
      index: {
        fileCount: 0,
        truncated: false,
        message: 'Indexing workspace…',
      },
    });
    const status = await this.publishIndexSnapshot();
    this.channel.appendLine(
      `[index] first-load ${status.message ?? 'done'} readiness=${status.readiness ?? 'n/a'}`,
    );
    return status;
  }

  private async readIndexStatus(): Promise<IndexStatusSnapshot> {
    const root = this.effectiveRoot();
    if (!root) {
      return {
        fileCount: 0,
        truncated: false,
        message: 'Open a workspace folder to index',
      };
    }
    if (this.lastIndex.fileCount > 0 && this.lastIndex.readiness) {
      return this.lastIndex;
    }
    const cached = join(root, '.mitii', 'last-repository-state.json');
    if (existsSync(cached)) {
      try {
        const raw = JSON.parse(readFileSync(cached, 'utf8')) as
          Partial<PersistedIndexState> & {
          fileCount?: number;
          truncated?: boolean;
          reasons?: Array<{ message?: string }>;
        };
        const reasons: Array<{ message?: string }> | undefined = raw.reasons;
        const fromReason = reasons
          ?.map((r) => r.message?.match(/(\d+)\s+files?/i)?.[1])
          .find(Boolean);
        const fileCount =
          typeof raw.fileCount === 'number'
            ? raw.fileCount
            : fromReason
              ? Number(fromReason)
              : this.lastIndex.fileCount;
        const truncated =
          typeof raw.truncated === 'boolean'
            ? raw.truncated
            : this.lastIndex.truncated;
        const descriptorStatus =
          typeof raw.workspaceId === 'string' &&
          typeof raw.stateToken === 'string' &&
          Array.isArray(raw.roots)
            ? indexStatusFromDescriptor(raw as RepositoryDescriptorSnapshot)
            : {};
        this.lastIndex = {
          fileCount,
          truncated,
          ...descriptorStatus,
          indexMode: raw.indexMode ?? this.lastIndex.indexMode,
          message:
            fileCount > 0
              ? `Loaded last published state (${fileCount} files)`
              : (this.lastIndex.message ?? 'Loaded last published state'),
        };
        return this.lastIndex;
      } catch {
        // fall through
      }
    }
    try {
      const client = await this.ensureClient();
      const latest = await client.getLatestRepositoryState(this.getWorkspaceId());
      if (latest) {
        const descriptorStatus = indexStatusFromDescriptor(latest);
        this.lastIndex = {
          fileCount: this.lastIndex.fileCount,
          truncated: this.lastIndex.truncated,
          ...descriptorStatus,
          indexMode: this.lastIndex.indexMode,
          message:
            this.lastIndex.fileCount > 0
              ? `From in-memory repository state (${this.lastIndex.fileCount} files)`
              : 'From in-memory repository state',
        };
        return this.lastIndex;
      }
    } catch {
      // no state yet
    }
    return this.lastIndex;
  }

  async publishIndexSnapshot(): Promise<IndexStatusSnapshot> {
    const root = this.effectiveRoot();
    if (!root) {
      return {
        fileCount: 0,
        truncated: false,
        message: 'Open a workspace folder to index',
      };
    }
    const client = await this.ensureClient();
    const dir = scaffoldMitiiWorkspace(root);
    let fileCount = 0;
    let truncated = false;
    let indexMode: IndexStatusSnapshot['indexMode'] = 'full';
    let fallbackReason: string | undefined;
    let published;
    try {
      const full = await runFullWorkspaceIndex({
        mitiiDir: dir,
        workspaceRoot: root,
        workspaceId: this.getWorkspaceId(),
        semanticIndex: await resolveVsCodeSemanticIndexSettings(
          this.vs,
          this.secrets,
        ),
      });
      fileCount = full.fileCount;
      truncated = full.truncated;
      published = await client.publishRepositoryStateFromIndexing(full.indexing, {
        catalogRevisionByRoot: full.catalogRevisionByRoot,
        graphRevisionByRoot: full.graphRevisionByRoot,
        mapRevisionByRoot: full.mapRevisionByRoot,
      });
      this.channel.appendLine(
        `[index] full code/text/graph/map index stored at ${full.databasePath}; vector=${full.vectorIndex.status}${full.vectorIndex.profileId ? ` profile=${full.vectorIndex.profileId}` : ''}${full.vectorIndex.reason ? ` reason=${full.vectorIndex.reason}` : ''}`,
      );
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : String(error);
      this.channel.appendLine(
        `[index] full index unavailable; falling back to host snapshot: ${fallbackReason}`,
      );
      indexMode = 'host_snapshot';
      const snapshot = await buildWorkspaceSnapshot({
        workspaceRoot: root,
        workspaceId: this.getWorkspaceId(),
      });
      fileCount = snapshot.fileCount;
      truncated = snapshot.truncated;
      published = await client.publishRepositoryState(snapshot.candidate);
    }
    if (published.status === 'published') {
      writeFileSync(
        join(dir, 'last-repository-state.json'),
        `${JSON.stringify(
          {
            ...published.descriptor,
            fileCount,
            truncated,
            indexMode,
          },
          null,
          2,
        )}\n`,
      );
      const descriptorStatus = indexStatusFromDescriptor(published.descriptor);
      this.lastIndex = {
        fileCount,
        truncated,
        ...descriptorStatus,
        indexMode,
        message:
          indexMode === 'host_snapshot'
            ? `Indexed ${fileCount} files (host snapshot fallback: ${fallbackReason ?? 'full index unavailable'})`
            : truncated
              ? `Indexed ${fileCount} files (truncated)`
              : `Indexed ${fileCount} files`,
      };
    } else {
      this.lastIndex = {
        fileCount,
        truncated,
        message: 'Index publish failed',
      };
    }
    return this.lastIndex;
  }

  private setActiveThreadUsage(usage: TokenUsageSnapshot): void {
    this.tokenUsage = {
      ...usage,
      contextWindow: resolveContextWindow(this.vs),
      live: false,
    };
    this.persistThreadUsage();
  }

  private persistThreadUsage(): void {
    if (!this.activeThreadId) return;
    this.tokenUsageByThread.set(this.activeThreadId, {
      ...this.tokenUsage,
      live: false,
    });
  }

  private async sendBootstrap(): Promise<void> {
    const history = loadHistory(this.host.workspaceState);
    const activeThread = history.activeThreadId
      ? history.threads.find((thread) => thread.id === history.activeThreadId)
      : undefined;
    const onboardingCompleted =
      this.vs.workspace
        .getConfiguration('mitii')
        .get<boolean>('onboarding.completed') ?? false;
    this.activeThreadId = history.activeThreadId;
    if (this.activeThreadId) {
      this.setActiveThreadUsage(
        this.tokenUsageByThread.get(this.activeThreadId) ??
          emptyTokenUsage(resolveContextWindow(this.vs)),
      );
    } else {
      this.setActiveThreadUsage(
        emptyTokenUsage(resolveContextWindow(this.vs)),
      );
    }
    this.post({
      type: 'bootstrap',
      workspace: this.readWorkspace(),
      provider: await this.readProvider(),
      index: await this.readIndexStatus(),
      mcp: readMcpSettings(this.vs, this.effectiveRoot()),
      mcpRuntimeStatus: this.mcpRuntimeStatus(),
      mcpStore: readMcpStoreCatalog(this.effectiveRoot()),
      ui: this.readUi(),
      tokenUsage: this.tokenUsage,
      notice: getWorkspaceTrustSnapshot(this.vs),
      onboardingRequired: !onboardingCompleted,
      flags: {
        skillManagement:
          this.host.extensionMode === this.vs.ExtensionMode.Development,
      },
      history: toThreadSummaries(history),
      activeThreadId: history.activeThreadId,
      activeThreadMessages: activeThread?.messages ?? [],
      memories: await loadMemoriesForView(
        this.host.workspaceState,
        this.getWorkspaceId(),
      ),
      checkpoints: loadCheckpoints(this.host.workspaceState),
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      this.vs.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      this.vs.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.css'),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Mitii</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
