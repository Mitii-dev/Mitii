import type * as vscode from 'vscode';

import type { MitiiClient, MitiiResumeInput } from '@mitii/sdk';

import { loadHistory } from './chatHistory.js';
import type {
  HostToWebviewMessage,
  IndexStatusSnapshot,
  SuspensionPayload,
  TokenUsageSnapshot,
  WorkspaceNoticeView,
} from './protocol.js';
import { acceptWebviewMessage } from './webviewInbound.js';
import { sendBootstrap } from './sidebar/bootstrap.js';
import { renderSidebarHtml } from './sidebar/html.js';
import {
  type SidebarHostHelpers,
  type SidebarHostOptions,
} from './sidebar/hostOptions.js';
import { SidebarIndexOrchestrator } from './sidebar/indexOrchestrator.js';
import { installMcpAppListener } from './sidebar/mcpAppListener.js';
import { routeWebviewMessage } from './sidebar/messageRouter.js';
import { SidebarRunController } from './sidebar/runController.js';
import type { SidebarServices } from './sidebar/services.js';
import { SidebarSessionState } from './sidebar/session.js';
import { SidebarSettingsService } from './sidebar/settingsService.js';
import { TokenUsageTracker } from './sidebar/tokenUsage.js';

export type { SidebarHostHelpers, SidebarHostOptions };

/**
 * Thin facade for the React sidebar: wires the session state, token meter,
 * settings service, index orchestrator, and run controller, then forwards
 * validated webview messages to the router. Ownership of each concern lives
 * under `./sidebar/`; see its README.
 */
export class MitiiSidebarProvider
  implements vscode.WebviewViewProvider, SidebarServices
{
  public static readonly viewType = 'mitii.sidebar';

  readonly session = new SidebarSessionState();
  readonly tokens: TokenUsageTracker;
  readonly settings: SidebarSettingsService;
  readonly indexer: SidebarIndexOrchestrator;
  readonly runs: SidebarRunController;

  constructor(
    readonly vs: typeof vscode,
    readonly extensionUri: vscode.Uri,
    readonly ensureClient: () => Promise<MitiiClient>,
    readonly getWorkspaceRoot: () => string | undefined,
    readonly getWorkspaceId: () => string,
    readonly channel: vscode.OutputChannel,
    readonly secrets: vscode.SecretStorage,
    readonly invalidateClient: () => void,
    readonly onIndexWorkspace: () => Promise<IndexStatusSnapshot>,
    readonly host: SidebarHostOptions,
  ) {
    this.tokens = new TokenUsageTracker({
      vs,
      getActiveThreadId: () => this.session.activeThreadId,
      isRunActive: () => this.session.isRunActive(),
    });
    this.settings = new SidebarSettingsService(this);
    this.indexer = new SidebarIndexOrchestrator(this);
    this.runs = new SidebarRunController(this);
    this.session.activeThreadId = loadHistory(
      host.workspaceState,
    ).activeThreadId;
    installMcpAppListener(this);
  }

  // --- Extension-facing API -------------------------------------------------

  attachHostHelpers(helpers: SidebarHostHelpers): void {
    this.session.hostHelpers = helpers;
  }

  resolveInlineDiffDecision(
    approvalId: string,
    decision: 'approved' | 'denied',
  ): void {
    this.runs.resolveInlineDiffDecision(approvalId, decision);
  }

  readIndexStatusPublic(): Promise<IndexStatusSnapshot> {
    return this.indexer.readIndexStatusPublic();
  }

  ensureIndexed(): Promise<IndexStatusSnapshot> {
    return this.indexer.ensureIndexed();
  }

  publishIndexSnapshot(
    options?: Parameters<SidebarIndexOrchestrator['publishIndexSnapshot']>[0],
  ): Promise<IndexStatusSnapshot> {
    return this.indexer.publishIndexSnapshot(options);
  }

  postTrustAndNotices(notice: WorkspaceNoticeView): void {
    this.post({ type: 'workspaceNotice', notice });
  }

  async reveal(): Promise<void> {
    await this.vs.commands.executeCommand('mitii.sidebar.focus');
  }

  async refreshBootstrap(): Promise<void> {
    if (this.settings.settingsWriteDepth > 0) return;
    await this.sendBootstrap();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.session.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.vs.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        this.vs.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    webview.html = renderSidebarHtml(this.vs, this.extensionUri, webview);
    webview.onDidReceiveMessage((raw: unknown) => {
      const message = acceptWebviewMessage(raw, (line) =>
        this.channel.appendLine(line),
      );
      if (message) void routeWebviewMessage(this, message);
    });
  }

  // --- SidebarContext seams (services call through these) -------------------

  post(message: HostToWebviewMessage): void {
    void this.session.view?.webview.postMessage(message);
  }

  effectiveRoot(): string | undefined {
    const override = this.vs.workspace
      .getConfiguration('mitii')
      .get<string>('workspace.rootPathOverride')
      ?.trim();
    if (override) return override;
    return this.getWorkspaceRoot();
  }

  sendBootstrap(): Promise<void> {
    return sendBootstrap(this);
  }

  refreshDiscoveredModels(options: {
    notify: boolean;
    type?: string;
    baseUrl?: string;
  }): Promise<void> {
    return this.settings.refreshDiscoveredModels(options);
  }

  // --- Stable internal seams (exercised by host tests) ----------------------

  handleSettingsSet(
    message: Parameters<SidebarSettingsService['handleSettingsSet']>[0],
  ): Promise<void> {
    return this.settings.handleSettingsSet(message);
  }

  applySettingsSet(
    message: Parameters<SidebarSettingsService['applySettingsSet']>[0],
  ): Promise<void> {
    return this.settings.applySettingsSet(message);
  }

  handleTestConnection(
    message: Parameters<SidebarSettingsService['handleTestConnection']>[0],
  ): Promise<void> {
    return this.settings.handleTestConnection(message);
  }

  readUi(): ReturnType<SidebarSettingsService['readUi']> {
    return this.settings.readUi();
  }

  readAutocomplete(): ReturnType<SidebarSettingsService['readAutocomplete']> {
    return this.settings.readAutocomplete();
  }

  readProvider(): ReturnType<SidebarSettingsService['readProvider']> {
    return this.settings.readProvider();
  }

  readSearch(): ReturnType<SidebarSettingsService['readSearch']> {
    return this.settings.readSearch();
  }

  withEmbedding(index: IndexStatusSnapshot): Promise<IndexStatusSnapshot> {
    return this.indexer.withEmbedding(index);
  }

  waitForSuspensionResume(
    suspension: SuspensionPayload,
  ): Promise<MitiiResumeInput | 'stop'> {
    return this.runs.waitForSuspensionResume(suspension);
  }

  /** Latest token-usage snapshot for the active thread. */
  get tokenUsage(): TokenUsageSnapshot {
    return this.tokens.usage;
  }

  get discoveredModels(): string[] {
    return this.settings.discoveredModels;
  }

  set discoveredModels(models: string[]) {
    this.settings.discoveredModels = models;
  }

  get runCancel(): vscode.CancellationTokenSource | undefined {
    return this.session.runCancel;
  }

  set runCancel(source: vscode.CancellationTokenSource | undefined) {
    this.session.runCancel = source;
  }

  get pendingResume(): SidebarSessionState['pendingResume'] {
    return this.session.pendingResume;
  }

  set pendingResume(value: SidebarSessionState['pendingResume']) {
    this.session.pendingResume = value;
  }

  get pendingSuspension(): SuspensionPayload | undefined {
    return this.session.pendingSuspension;
  }

  set pendingSuspension(value: SuspensionPayload | undefined) {
    this.session.pendingSuspension = value;
  }
}
