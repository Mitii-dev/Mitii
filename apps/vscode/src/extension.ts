import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';

import type { MitiiClient } from '@mitii/sdk';

import { runAskInOutputChannel } from './hostAsk.js';
import { createVscodeClient } from './ports.js';
import { buildSessionExport } from './runReport.js';
import { MitiiSidebarProvider } from './sidebar.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';

const execFileAsync = promisify(execFile);

/**
 * Phase 15/17 host package: activation composes @mitii/sdk only.
 */
export function activate(context: ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Mitii');
  context.subscriptions.push(channel);

  let client: MitiiClient | undefined;
  let workspaceId = 'vscode_workspace';

  const workspaceRoot = (): string | undefined =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const invalidateClient = (): void => {
    client = undefined;
  };

  const ensureClient = async (): Promise<MitiiClient> => {
    if (client) return client;
    const composed = await createVscodeClient(
      vscode,
      context.secrets,
      workspaceRoot(),
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
      'Mitii API key saved. Set mitii.provider.type to openai-compatible to use it.',
    );
  };

  const clearApiKey = async (): Promise<void> => {
    await context.secrets.delete('mitii.provider.apiKey');
    invalidateClient();
    channel.appendLine('[mitii] SecretStorage mitii.provider.apiKey cleared');
    void vscode.window.showInformationMessage('Mitii API key cleared.');
  };

  const openChat = async (): Promise<void> => {
    const prompt = await vscode.window.showInputBox({
      prompt: 'Ask Mitii',
      placeHolder: 'What should Mitii answer?',
      ignoreFocusOut: true,
    });
    if (!prompt?.trim()) return;
    const c = await ensureClient();
    try {
      const outcome = await runAskInOutputChannel({
        vs: vscode,
        client: c,
        prompt: prompt.trim(),
        workspaceRoot: workspaceRoot(),
        channel,
      });
      if (outcome.result.status === 'cancelled') {
        void vscode.window.showWarningMessage('Mitii run cancelled.');
      } else if (outcome.result.status === 'failed') {
        void vscode.window.showErrorMessage(
          outcome.result.error?.message ?? 'Mitii run failed.',
        );
      } else if (outcome.result.status === 'completed') {
        void vscode.window.showInformationMessage('Mitii ask completed.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      channel.appendLine(`[error] ${message}`);
      void vscode.window.showErrorMessage(`Mitii ask failed: ${message}`);
    }
  };

  const indexWorkspace = async (): Promise<void> => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a folder to index.');
      return;
    }
    const c = await ensureClient();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Mitii: indexing workspace',
        cancellable: false,
      },
      async () => {
        const snapshot = await buildWorkspaceSnapshot({
          workspaceRoot: root,
          workspaceId,
        });
        const published = await c.publishRepositoryState(snapshot.candidate);
        if (published.status === 'published') {
          const dir = join(root, '.mitii');
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, 'last-repository-state.json'),
            `${JSON.stringify(published.descriptor, null, 2)}\n`,
          );
          channel.appendLine(
            `[index] readiness=${published.descriptor.readiness} token=${published.reference.stateToken.slice(0, 16)}… files=${snapshot.fileCount}`,
          );
          for (const reason of published.descriptor.reasons) {
            channel.appendLine(`[index] ${reason.code}: ${reason.message}`);
          }
          void vscode.window.showInformationMessage(
            `Mitii indexed (${published.descriptor.readiness}).`,
          );
        } else {
          void vscode.window.showErrorMessage('Mitii index failed.');
        }
      },
    );
  };

  const generateCommitMessage = async (): Promise<void> => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a git folder first.');
      return;
    }
    let statusText = '';
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain', '-b'],
        { cwd: root, timeout: 10_000 },
      );
      statusText = stdout.trim() || '(clean)';
    } catch {
      void vscode.window.showErrorMessage('Unable to read git status.');
      return;
    }
    const c = await ensureClient();
    const prompt = `Write a concise git commit message for this repository status:\n\n${statusText}`;
    const outcome = await runAskInOutputChannel({
      vs: vscode,
      client: c,
      prompt,
      workspaceRoot: root,
      channel,
      mode: 'ask',
    });
    const message =
      outcome.result.answer?.trim() ||
      'chore: update workspace';
    await vscode.env.clipboard.writeText(message);
    void vscode.window.showInformationMessage(
      'Commit message copied to clipboard.',
    );
  };

  const exportSession = async (): Promise<void> => {
    const prompt = await vscode.window.showInputBox({
      prompt: 'Prompt to run before exporting session log',
      value: 'Summarize the current workspace briefly.',
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
    });
    const payload = buildSessionExport({
      result: outcome.result,
      events: outcome.events,
    });
    const outPath = join(root ?? context.globalStorageUri.fsPath, '.mitii-session-export.json');
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    channel.appendLine(`[export] wrote ${outPath}`);
    void vscode.window.showInformationMessage(`Exported session to ${outPath}`);
  };

  const sidebar = new MitiiSidebarProvider(
    vscode,
    ensureClient,
    workspaceRoot,
    channel,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MitiiSidebarProvider.viewType,
      sidebar,
    ),
    vscode.commands.registerCommand('mitii.openChat', openChat),
    vscode.commands.registerCommand('mitii.indexWorkspace', indexWorkspace),
    vscode.commands.registerCommand(
      'mitii.generateCommitMessage',
      generateCommitMessage,
    ),
    vscode.commands.registerCommand('mitii.exportSessionLog', exportSession),
    vscode.commands.registerCommand('mitii.exportAuditPack', exportSession),
    vscode.commands.registerCommand('mitii.setApiKey', setApiKey),
    vscode.commands.registerCommand('mitii.clearApiKey', clearApiKey),
    vscode.commands.registerCommand('mitii.showSettings', async () => {
      // Query by setting prefix so it works regardless of npm-scoped package name.
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@id:mitii.provider.type',
      );
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('mitii.provider')) {
        invalidateClient();
        channel.appendLine('[mitii] provider settings changed; client will recompose');
      }
    }),
  );

  // Warm client so sidebar asks work after first openChat/index.
  void ensureClient().catch((error) => {
    channel.appendLine(
      `[mitii] client init deferred: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

export function deactivate(): void {
  // no-op
}
