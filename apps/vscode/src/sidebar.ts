import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as vscode from 'vscode';

import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type MitiiClient,
  type MitiiResumeInput,
} from '@mitii/sdk';

import { runAskInOutputChannel } from './hostAsk.js';
import { readMcpSettings, writeMcpSettings } from './mcpConfig.js';
import { LOCAL_MODEL_PRESETS } from './modelPresets.js';
import { searchWorkspacePaths } from './pathSearch.js';
import type {
  HostToWebviewMessage,
  IndexStatusSnapshot,
  ProviderSettingsSnapshot,
  RunUsagePayload,
  TokenUsageSnapshot,
  UiSettingsSnapshot,
  WebviewToHostMessage,
  WorkspaceSnapshotInfo,
} from './protocol.js';
import { testProviderConnection } from './testConnection.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';

const DEFAULT_CONTEXT_WINDOW = 8192;

function emptyTokenUsage(): TokenUsageSnapshot {
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
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    estimated: true,
  };
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
  private discoveredModels: string[] = [];
  private connectionOk?: boolean;
  private connectionStatus?: string;
  private tokenUsage: TokenUsageSnapshot = emptyTokenUsage();

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
  ) {}

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

  /** Focus sidebar from commands. */
  async reveal(): Promise<void> {
    await this.vs.commands.executeCommand('mitii.sidebar.focus');
  }

  /** Re-push settings after VS Code configuration changes. */
  async refreshBootstrap(): Promise<void> {
    await this.sendBootstrap();
  }

  post(message: HostToWebviewMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private async onMessage(message: WebviewToHostMessage): Promise<void> {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'ready':
        await this.sendBootstrap();
        return;
      case 'ask':
        await this.handleAsk(message);
        return;
      case 'cancel':
        this.runCancel?.cancel();
        return;
      case 'resume':
        this.handleResume(message);
        return;
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
      case 'navigate':
        return;
      default:
        return;
    }
  }

  private handleResume(message: Extract<WebviewToHostMessage, { type: 'resume' }>): void {
    if (!this.pendingResume) return;
    const { resolve } = this.pendingResume;
    this.pendingResume = undefined;
    if (message.clarificationAnswer?.trim()) {
      resolve({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: message.runId,
        clarificationAnswer: message.clarificationAnswer.trim(),
      });
      return;
    }
    if (message.approval) {
      resolve({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: message.runId,
        approval: message.approval,
      });
      return;
    }
    resolve('stop');
  }

  private async handleAsk(
    message: Extract<WebviewToHostMessage, { type: 'ask' }>,
  ): Promise<void> {
    const prompt = String(message.prompt ?? '').trim();
    if (!prompt) return;
    this.runCancel?.dispose();
    this.runCancel = new this.vs.CancellationTokenSource();
    const mode = message.mode ?? 'ask';
    this.post({ type: 'run.started', mode, prompt });
    try {
      const client = await this.ensureClient();
      const outcome = await runAskInOutputChannel({
        vs: this.vs,
        client,
        prompt,
        workspaceRoot: this.effectiveRoot(),
        channel: this.channel,
        mode,
        depth: message.depth,
        pinnedPaths: message.pinnedPaths,
        handlers: {
          cancelToken: this.runCancel.token,
          onEvent: (_event, activity) => {
            this.post({ type: 'run.event', event: activity });
          },
          onDelta: (text) => {
            this.post({ type: 'run.delta', text });
          },
          onSuspended: async (_result, suspension) => {
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
      const usage = this.recordUsage(outcome.result);
      this.post({
        type: 'run.result',
        status: outcome.result.status,
        answer: outcome.result.answer ?? '',
        route: outcome.result.route ?? null,
        error: outcome.result.error?.message,
        usage,
      });
      this.post({ type: 'tokenUsage', usage: this.tokenUsage });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.post({ type: 'error', message: text });
      this.post({
        type: 'run.result',
        status: 'failed',
        error: text,
      });
    } finally {
      this.runCancel?.dispose();
      this.runCancel = undefined;
      if (this.pendingResume) {
        this.pendingResume.resolve('stop');
        this.pendingResume = undefined;
      }
    }
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

  private recordUsage(result: {
    usage: {
      modelCalls: number;
      toolCalls: number;
      loopIterations: number;
      inputTokens?: number;
      outputTokens?: number;
    };
    durationMs: number;
  }): RunUsagePayload {
    const input = result.usage.inputTokens ?? 0;
    const output = result.usage.outputTokens ?? 0;
    const turnTotal = input + output;
    this.tokenUsage = {
      ...this.tokenUsage,
      inputTokensTotal: this.tokenUsage.inputTokensTotal + input,
      outputTokensTotal: this.tokenUsage.outputTokensTotal + output,
      sessionTotal:
        this.tokenUsage.inputTokensTotal +
        input +
        this.tokenUsage.outputTokensTotal +
        output,
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
      estimated: result.usage.inputTokens === undefined,
      durationMs: result.durationMs,
    };
    return {
      modelCalls: result.usage.modelCalls,
      toolCalls: result.usage.toolCalls,
      loopIterations: result.usage.loopIterations,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
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
    return {
      type: cfg.get<string>('provider.type') ?? 'echo',
      baseUrl: cfg.get<string>('provider.baseUrl') ?? 'http://localhost:11434/v1',
      model,
      hasApiKey,
      availableModels: this.buildAvailableModels(model),
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

  private async readIndexStatus(): Promise<IndexStatusSnapshot> {
    const root = this.effectiveRoot();
    if (!root) {
      return {
        fileCount: 0,
        truncated: false,
        message: 'Open a workspace folder to index',
      };
    }
    const cached = join(root, '.mitii', 'last-repository-state.json');
    if (existsSync(cached)) {
      try {
        const raw = JSON.parse(readFileSync(cached, 'utf8')) as {
          readiness?: string;
          stateToken?: string;
          generatedAt?: string;
        };
        return {
          ...this.lastIndex,
          readiness: raw.readiness,
          stateTokenPreview: raw.stateToken?.slice(0, 16),
          lastIndexedAt: raw.generatedAt,
          message: this.lastIndex.message ?? 'Loaded last published state',
        };
      } catch {
        // fall through
      }
    }
    try {
      const client = await this.ensureClient();
      const latest = await client.getLatestRepositoryState(this.getWorkspaceId());
      if (latest) {
        return {
          fileCount: this.lastIndex.fileCount,
          truncated: this.lastIndex.truncated,
          readiness: latest.readiness,
          stateTokenPreview: latest.stateToken?.slice(0, 16),
          lastIndexedAt: latest.generatedAt,
          message: 'From in-memory repository state',
        };
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
    const snapshot = await buildWorkspaceSnapshot({
      workspaceRoot: root,
      workspaceId: this.getWorkspaceId(),
    });
    const published = await client.publishRepositoryState(snapshot.candidate);
    const dir = join(root, '.mitii');
    mkdirSync(dir, { recursive: true });
    if (published.status === 'published') {
      writeFileSync(
        join(dir, 'last-repository-state.json'),
        `${JSON.stringify(published.descriptor, null, 2)}\n`,
      );
      this.lastIndex = {
        fileCount: snapshot.fileCount,
        truncated: snapshot.truncated,
        readiness: published.descriptor.readiness,
        stateTokenPreview: published.reference.stateToken.slice(0, 16),
        lastIndexedAt: published.descriptor.generatedAt,
        message: snapshot.truncated
          ? `Indexed ${snapshot.fileCount} files (truncated)`
          : `Indexed ${snapshot.fileCount} files`,
      };
    } else {
      this.lastIndex = {
        fileCount: snapshot.fileCount,
        truncated: snapshot.truncated,
        message: 'Index publish failed',
      };
    }
    return this.lastIndex;
  }

  private async sendBootstrap(): Promise<void> {
    this.post({
      type: 'bootstrap',
      workspace: this.readWorkspace(),
      provider: await this.readProvider(),
      index: await this.readIndexStatus(),
      mcp: readMcpSettings(this.vs, this.effectiveRoot()),
      ui: this.readUi(),
      tokenUsage: this.tokenUsage,
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
