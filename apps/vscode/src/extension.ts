import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';

import type { MitiiClient } from '@mitii/sdk';

import { captureEditorContext } from './context/editorContext.js';
import { InlineDiffManager } from './diff/inlineDiffManager.js';
import { showWriteDiffPreview } from './diff/diffPreview.js';
import { runAskInOutputChannel } from './hostAsk.js';
import { mitiiAuditDir, scaffoldMitiiWorkspace } from './mitiiWorkspace.js';
import { createVscodeClient } from './ports.js';
import type { IndexStatusSnapshot } from './protocol.js';
import { buildAuditPack, buildSessionExport } from './runReport.js';
import { runCommitMessageWithScmUi } from './scm/registerScm.js';
import {
  findLatestSessionLog,
  writeSessionExport,
} from './sessionLog.js';
import { MitiiSidebarProvider } from './sidebar.js';
import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import { resolveVsCodeSemanticIndexSettings } from './semanticIndex.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';
import {
  getWorkspaceTrustSnapshot,
  onWorkspaceTrustChanged,
} from './workspace/trust.js';

const execFileAsync = promisify(execFile);

/**
 * VS Code host: activation composes @mitii/sdk and serves the React sidebar.
 */
export function activate(context: ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Mitii');
  context.subscriptions.push(channel);

  const debugEnabled = (): boolean =>
    vscode.workspace.getConfiguration('mitii').get<boolean>('debug') === true;

  const debugLog = (line: string): void => {
    if (debugEnabled()) channel.appendLine(line);
  };

  const extensionVersion =
    (context.extension?.packageJSON as { version?: string } | undefined)
      ?.version ?? 'unknown';
  channel.appendLine(
    `[mitii] activate v${extensionVersion} · ${new Date().toISOString()}`,
  );
  channel.appendLine(
    `[mitii] extensionMode=${context.extensionMode} · debug=${debugEnabled()}`,
  );
  if (debugEnabled() || context.extensionMode === vscode.ExtensionMode.Development) {
    channel.show(true);
  }

  let client: MitiiClient | undefined;
  let workspaceId = 'vscode_workspace';
  let lastSessionExportPath: string | undefined;

  const workspaceRoot = (): string | undefined =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const rootAtActivate = workspaceRoot();
  channel.appendLine(
    `[mitii] workspaceRoot=${rootAtActivate ?? '(none)'}`,
  );
  if (rootAtActivate) {
    try {
      const dir = scaffoldMitiiWorkspace(rootAtActivate);
      channel.appendLine(`[mitii] workspace data: ${dir}`);
    } catch (error) {
      const detail =
        error instanceof Error
          ? debugEnabled() && error.stack
            ? error.stack
            : error.message
          : String(error);
      channel.appendLine(`[mitii] scaffold failed: ${detail}`);
    }
  } else {
    channel.appendLine(
      '[mitii] no folder open — indexing and agent runs need a workspace',
    );
  }

  const invalidateClient = (): void => {
    client = undefined;
  };

  const ensureClient = async (): Promise<MitiiClient> => {
    if (client) return client;
    const composed = await createVscodeClient(
      vscode,
      context.secrets,
      workspaceRoot(),
      { workspaceState: context.workspaceState },
    );
    client = composed.client;
    workspaceId = composed.ports.workspaceId;
    channel.appendLine(`[mitii] provider=${composed.ports.providerLabel}`);
    return client;
  };

  const setApiKey = async (): Promise<void> => {
    const key = await vscode.window.showInputBox({
      prompt: 'Provider API key (stored in SecretStorage as mitii.provider.apiKey)',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'sk-…',
    });
    if (key === undefined) return;
    const trimmed = key.trim();
    if (!trimmed) {
      void vscode.window.showWarningMessage('API key not set (empty).');
      return;
    }
    await context.secrets.store('mitii.provider.apiKey', trimmed);
    invalidateClient();
    channel.appendLine('[mitii] SecretStorage mitii.provider.apiKey updated');
    void vscode.window.showInformationMessage(
      'Mitii API key saved. Use Provider → openai-compatible for cloud APIs; local Ollama does not need a key.',
    );
  };

  const clearApiKey = async (): Promise<void> => {
    await context.secrets.delete('mitii.provider.apiKey');
    invalidateClient();
    channel.appendLine('[mitii] SecretStorage mitii.provider.apiKey cleared');
    void vscode.window.showInformationMessage('Mitii API key cleared.');
  };

  let sidebar: MitiiSidebarProvider;

  const inlineDiff = new InlineDiffManager(
    vscode,
    async (approvalId) => {
      sidebar?.resolveInlineDiffDecision(approvalId, 'approved');
    },
    async (approvalId) => {
      sidebar?.resolveInlineDiffDecision(approvalId, 'denied');
    },
  );
  context.subscriptions.push(inlineDiff);

  const setInlineDiffContext = (pending: boolean): void => {
    void vscode.commands.executeCommand(
      'setContext',
      'mitii.inlineDiffPending',
      pending,
    );
  };

  const indexWorkspace = async (): Promise<IndexStatusSnapshot> => {
    const root =
      vscode.workspace
        .getConfiguration('mitii')
        .get<string>('workspace.rootPathOverride')
        ?.trim() || workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a folder to index.');
      return {
        fileCount: 0,
        truncated: false,
        message: 'Open a workspace folder to index',
      };
    }
    if (sidebar) {
      const status = await sidebar.publishIndexSnapshot();
      void vscode.window.showInformationMessage(
        status.message ?? 'Mitii index updated.',
      );
      return status;
    }
    const c = await ensureClient();
    const dir = join(root, '.mitii');
    mkdirSync(dir, { recursive: true });
    let fileCount = 0;
    let truncated = false;
    let indexMode: IndexStatusSnapshot['indexMode'] = 'full';
    let fallbackReason: string | undefined;
    let published;
    try {
      const full = await runFullWorkspaceIndex({
        mitiiDir: dir,
        workspaceRoot: root,
        workspaceId,
        semanticIndex: await resolveVsCodeSemanticIndexSettings(
          vscode,
          context.secrets,
        ),
      });
      fileCount = full.fileCount;
      truncated = full.truncated;
      published = await c.publishRepositoryStateFromIndexing(full.indexing, {
        catalogRevisionByRoot: full.catalogRevisionByRoot,
        graphRevisionByRoot: full.graphRevisionByRoot,
        mapRevisionByRoot: full.mapRevisionByRoot,
      });
      channel.appendLine(
        `[index] full code/text/graph/map index stored at ${full.databasePath}; vector=${full.vectorIndex.status}${full.vectorIndex.profileId ? ` profile=${full.vectorIndex.profileId}` : ''}${full.vectorIndex.reason ? ` reason=${full.vectorIndex.reason}` : ''}`,
      );
    } catch (error) {
      indexMode = 'host_snapshot';
      fallbackReason = error instanceof Error ? error.message : String(error);
      channel.appendLine(
        `[index] full index unavailable; falling back to host snapshot: ${fallbackReason}`,
      );
      const snapshot = await buildWorkspaceSnapshot({
        workspaceRoot: root,
        workspaceId,
      });
      fileCount = snapshot.fileCount;
      truncated = snapshot.truncated;
      published = await c.publishRepositoryState(snapshot.candidate);
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
      channel.appendLine(
        `[index] readiness=${published.descriptor.readiness} token=${published.reference.stateToken.slice(0, 16)}… files=${fileCount}`,
      );
      void vscode.window.showInformationMessage(
        `Mitii indexed (${published.descriptor.readiness}).`,
      );
      return {
        fileCount,
        truncated,
        readiness: published.descriptor.readiness,
        stateTokenPreview: published.reference.stateToken.slice(0, 16),
        lastIndexedAt: published.descriptor.generatedAt,
        indexMode,
        message:
          indexMode === 'host_snapshot'
            ? `Indexed ${fileCount} files (host snapshot fallback: ${fallbackReason ?? 'full index unavailable'})`
            : truncated
              ? `Indexed ${fileCount} files (truncated)`
              : `Indexed ${fileCount} files`,
      };
    }
    void vscode.window.showErrorMessage('Mitii index failed.');
    return {
      fileCount,
      truncated,
      message: 'Index publish failed',
    };
  };

  const openChat = async (): Promise<void> => {
    await vscode.commands.executeCommand('mitii.sidebar.focus');
    sidebar?.post({ type: 'setTab', tab: 'chat' });
  };

  const generateCommitMessage = async (): Promise<void> => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a git folder first.');
      return;
    }
    const style =
      vscode.workspace
        .getConfiguration('mitii')
        .get<string>('scm.commitMessageStyle') ?? 'conventional';
    try {
      await runCommitMessageWithScmUi({
        vs: vscode,
        workspaceRoot: root,
        generate: async () => {
          let statusText = '';
          try {
            const { stdout } = await execFileAsync(
              'git',
              ['status', '--porcelain', '-b'],
              { cwd: root, timeout: 10_000 },
            );
            statusText = stdout.trim() || '(clean)';
          } catch {
            throw new Error('Unable to read git status.');
          }
          const c = await ensureClient();
          const styleHint =
            style === 'conventional'
              ? 'Use Conventional Commits (type(scope): subject).'
              : 'Use a plain short subject line.';
          const prompt = `Write a concise git commit message for this repository status.\n${styleHint}\n\n${statusText}`;
          const outcome = await runAskInOutputChannel({
            vs: vscode,
            client: c,
            prompt,
            workspaceRoot: root,
            channel,
            mode: 'ask',
            workspaceId,
            workspaceState: context.workspaceState,
            secrets: context.secrets,
          });
          return (
            outcome.result.answer?.trim() || 'chore: update workspace'
          );
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Mitii: ${message}`);
    }
  };

  const exportSession = async (): Promise<string | undefined> => {
    const prompt = await vscode.window.showInputBox({
      prompt: 'Prompt to run before exporting session log',
      value: 'Summarize the current workspace briefly.',
    });
    if (!prompt?.trim()) return undefined;
    const root = workspaceRoot();
    const c = await ensureClient();
    const outcome = await runAskInOutputChannel({
      vs: vscode,
      client: c,
      prompt: prompt.trim(),
      workspaceRoot: root,
      channel,
      workspaceId,
      workspaceState: context.workspaceState,
      secrets: context.secrets,
    });
    const payload = buildSessionExport({
      result: outcome.result,
      events: outcome.events,
    });
    const outPath = writeSessionExport(
      root,
      context.globalStorageUri.fsPath,
      payload,
    );
    lastSessionExportPath = outPath;
    channel.appendLine(`[export] wrote ${outPath}`);
    void vscode.window.showInformationMessage(`Exported session to ${outPath}`);
    return outPath;
  };

  const exportAudit = async (): Promise<void> => {
    const prompt = await vscode.window.showInputBox({
      prompt: 'Prompt to run before exporting audit pack',
      value: 'Summarize recent agent activity for audit.',
    });
    if (!prompt?.trim()) return;
    const root = workspaceRoot();
    const c = await ensureClient();
    const outcome = await runAskInOutputChannel({
      vs: vscode,
      client: c,
      prompt: prompt.trim(),
      workspaceRoot: root,
      channel,
      workspaceId,
      workspaceState: context.workspaceState,
      secrets: context.secrets,
    });
    const cfg = vscode.workspace.getConfiguration('mitii');
    const settingsRedacted = {
      provider: {
        type: cfg.get('provider.type'),
        baseUrl: cfg.get('provider.baseUrl'),
        model: cfg.get('provider.model'),
        hasApiKey: Boolean(await context.secrets.get('mitii.provider.apiKey')),
      },
      ui: {
        showReasoning: cfg.get('ui.showReasoning'),
        depth: cfg.get('ui.depth'),
        contextToggles: {
          editor: cfg.get('ui.contextToggles.editor'),
          diagnostics: cfg.get('ui.contextToggles.diagnostics'),
          openTabs: cfg.get('ui.contextToggles.openTabs'),
          gitDiff: cfg.get('ui.contextToggles.gitDiff'),
          memory: cfg.get('ui.contextToggles.memory'),
          repoMap: cfg.get('ui.contextToggles.repoMap'),
        },
      },
      safety: { approvalMode: cfg.get('safety.approvalMode') },
      mcpEnabled: Boolean(
        (cfg.get('mcp') as { enabled?: boolean } | undefined)?.enabled,
      ),
    };
    const indexMeta = sidebar
      ? await sidebar.readIndexStatusPublic()
      : undefined;
    const payload = buildAuditPack({
      result: outcome.result,
      events: outcome.events,
      settingsRedacted,
      indexMeta: indexMeta as unknown as Record<string, unknown>,
      workspaceRoot: root,
    });
    const auditDir = root
      ? mitiiAuditDir(root)
      : context.globalStorageUri.fsPath;
    mkdirSync(auditDir, { recursive: true });
    const outPath = join(auditDir, 'audit-pack.json');
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    channel.appendLine(`[audit] wrote ${outPath}`);
    void vscode.window.showInformationMessage(`Exported audit pack to ${outPath}`);
  };

  const openSessionLog = async (): Promise<void> => {
    const root = workspaceRoot();
    const candidate =
      lastSessionExportPath ??
      findLatestSessionLog(root) ??
      (root ? join(root, '.mitii-session-export.json') : undefined);
    if (!candidate || !existsSync(candidate)) {
      const created = await exportSession();
      if (!created) return;
      const doc = await vscode.workspace.openTextDocument(created);
      await vscode.window.showTextDocument(doc);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(candidate);
    await vscode.window.showTextDocument(doc);
  };

  const generateDocAsk = async (
    title: string,
    prompt: string,
    fileName: string,
  ): Promise<void> => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a folder first.');
      return;
    }
    const c = await ensureClient();
    const outcome = await runAskInOutputChannel({
      vs: vscode,
      client: c,
      prompt,
      workspaceRoot: root,
      channel,
      mode: 'ask',
      workspaceId,
      workspaceState: context.workspaceState,
      secrets: context.secrets,
    });
    const body =
      outcome.result.answer?.trim() ||
      `# ${title}\n\n_(No model answer — check provider settings.)_\n`;
    const outPath = join(root, '.mitii', fileName);
    mkdirSync(join(root, '.mitii'), { recursive: true });
    writeFileSync(outPath, `${body}\n`);
    const doc = await vscode.workspace.openTextDocument(outPath);
    await vscode.window.showTextDocument(doc);
  };

  sidebar = new MitiiSidebarProvider(
    vscode,
    context.extensionUri,
    ensureClient,
    workspaceRoot,
    () => workspaceId,
    channel,
    context.secrets,
    invalidateClient,
    indexWorkspace,
    {
      extensionMode: context.extensionMode,
      workspaceState: context.workspaceState,
      inlineDiff,
      onInlineDiffPending: setInlineDiffContext,
    },
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MitiiSidebarProvider.viewType,
      sidebar,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('mitii.openChat', openChat),
    vscode.commands.registerCommand('mitii.indexWorkspace', async () => {
      await indexWorkspace();
    }),
    vscode.commands.registerCommand(
      'mitii.generateCommitMessage',
      generateCommitMessage,
    ),
    vscode.commands.registerCommand('mitii.exportSessionLog', async () => {
      await exportSession();
    }),
    vscode.commands.registerCommand('mitii.exportAuditPack', exportAudit),
    vscode.commands.registerCommand('mitii.openSessionLog', openSessionLog),
    vscode.commands.registerCommand('mitii.generateChangelog', async () => {
      await generateDocAsk(
        'Changelog',
        'Generate a concise CHANGELOG markdown section for recent work in this repository based on git status and typical recent changes. Use Keep a Changelog style.',
        'CHANGELOG-draft.md',
      );
    }),
    vscode.commands.registerCommand('mitii.prepareRelease', async () => {
      await generateDocAsk(
        'Release notes',
        'Prepare release notes markdown for the next version of this project: summary, highlights, breaking changes, and upgrade notes.',
        'RELEASE-NOTES-draft.md',
      );
    }),
    vscode.commands.registerCommand('mitii.showInlineDiff', async () => {
      const pending = inlineDiff.getPending();
      if (!pending) {
        void vscode.window.showInformationMessage(
          'No pending Mitii inline diff.',
        );
        return;
      }
      const root = workspaceRoot();
      if (!root) return;
      await inlineDiff.showForApproval(
        root,
        pending.approvalId,
        pending.relPath,
        pending.toolName,
        pending.proposedText,
        pending.originalText,
      );
    }),
    vscode.commands.registerCommand('mitii.setApiKey', setApiKey),
    vscode.commands.registerCommand('mitii.clearApiKey', clearApiKey),
    vscode.commands.registerCommand('mitii.showSettings', async () => {
      await vscode.commands.executeCommand('mitii.sidebar.focus');
      sidebar.post({ type: 'openSettings', tab: 'model' });
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      const root = workspaceRoot();
      const snap = captureEditorContext(vscode, root, {
        includeOpenTabs: true,
      });
      if (snap.activeRelPath) {
        sidebar.post({
          type: 'editorPin',
          path: snap.activeRelPath,
          source: 'auto',
        });
      }
      sidebar.post({
        type: 'syncAutoPins',
        paths: snap.openTabRelPaths.length
          ? snap.openTabRelPaths
          : snap.activeRelPath
            ? [snap.activeRelPath]
            : [],
      });
      sidebar.postTrustAndNotices(getWorkspaceTrustSnapshot(vscode));
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme !== 'file') return;
      const root = workspaceRoot();
      const snap = captureEditorContext(vscode, root, {
        includeOpenTabs: true,
      });
      // Prefer full sync so soft pins match still-open tabs.
      sidebar.post({
        type: 'syncAutoPins',
        paths: snap.openTabRelPaths,
      });
      debugLog(`[mitii] document closed → syncAutoPins (${snap.openTabRelPaths.length})`);
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      const root = workspaceRoot();
      const snap = captureEditorContext(vscode, root, {
        includeOpenTabs: true,
      });
      sidebar.post({
        type: 'syncAutoPins',
        paths: snap.openTabRelPaths,
      });
    }),
    onWorkspaceTrustChanged(vscode, (snap) => {
      sidebar.postTrustAndNotices(snap);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('mitii.debug')) {
        channel.appendLine(
          `[mitii] debug logging ${debugEnabled() ? 'enabled' : 'disabled'}`,
        );
        if (debugEnabled()) channel.show(true);
      }
      if (
        event.affectsConfiguration('mitii.provider') ||
        event.affectsConfiguration('mitii.workspace') ||
        event.affectsConfiguration('mitii.mcp') ||
        event.affectsConfiguration('mitii.ui') ||
        event.affectsConfiguration('mitii.safety') ||
        event.affectsConfiguration('mitii.onboarding')
      ) {
        if (
          event.affectsConfiguration('mitii.provider') ||
          event.affectsConfiguration('mitii.mcp') ||
          event.affectsConfiguration('mitii.ui.contextToggles.memory')
        ) {
          invalidateClient();
          channel.appendLine(
            '[mitii] provider/mcp/memory settings changed; client will recompose',
          );
        }
        void (async () => {
          const status = await sidebar.ensureIndexed();
          sidebar.post({ type: 'index.status', index: status });
          await sidebar.refreshBootstrap();
        })();
      }
    }),
  );

  // Expose diff preview helper for sidebar without circular imports
  sidebar.attachHostHelpers({
    showWriteDiffPreview: async (relPath, content) => {
      const root = workspaceRoot();
      if (!root) return;
      await showWriteDiffPreview(vscode, root, relPath, content);
    },
  });

  void ensureClient()
    .then(async () => {
      channel.appendLine('[mitii] client composed OK');
      if (!workspaceRoot()) return;
      const status = await sidebar.ensureIndexed();
      channel.appendLine(
        `[index] activation ${status.message ?? 'ready'} files=${status.fileCount}`,
      );
    })
    .catch((error) => {
      const detail =
        error instanceof Error
          ? debugEnabled() && error.stack
            ? error.stack
            : error.message
          : String(error);
      channel.appendLine(`[mitii] client/index init deferred: ${detail}`);
      if (debugEnabled()) channel.show(true);
    });

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const root = workspaceRoot();
      invalidateClient();
      if (!root) return;
      try {
        channel.appendLine(
          `[mitii] workspace data: ${scaffoldMitiiWorkspace(root)}`,
        );
      } catch (error) {
        channel.appendLine(
          `[mitii] scaffold failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      void sidebar.ensureIndexed().then((status) => {
        sidebar.post({ type: 'index.status', index: status });
        channel.appendLine(
          `[index] workspace-folder change ${status.message ?? 'ready'}`,
        );
      });
    }),
  );

  channel.appendLine('[mitii] activation complete');
}

export function deactivate(): void {
  // no-op
}
