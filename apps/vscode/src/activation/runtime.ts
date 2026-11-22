import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';

import type { MitiiClient } from '@mitii/sdk';

import { scaffoldMitiiWorkspace } from '../mitiiWorkspace.js';
import { createVscodeClient } from '../ports.js';
import type { MitiiSidebarProvider } from '../sidebar.js';

/** Shared activation state and helpers handed to every command module. */
export interface ActivationRuntime {
  readonly context: ExtensionContext;
  readonly channel: vscode.OutputChannel;
  debugEnabled(): boolean;
  debugLog(line: string): void;
  workspaceRoot(): string | undefined;
  workspaceId(): string;
  ensureClient(): Promise<MitiiClient>;
  invalidateClient(): void;
  /** Coalesce profile/settings storms into one ensure after writes settle. */
  scheduleEnsureIndexed(delayMs?: number): void;
  /** Assigned once the sidebar provider is constructed. */
  sidebar: MitiiSidebarProvider | undefined;
  lastSessionExportPath: string | undefined;
  indexAbort: AbortController | undefined;
}

export function createActivationRuntime(
  context: ExtensionContext,
): ActivationRuntime {
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

  /** Coalesce profile/settings storms into one ensure after writes settle. */
  let ensureIndexedTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleEnsureIndexed = (delayMs = 500): void => {
    if (ensureIndexedTimer) clearTimeout(ensureIndexedTimer);
    ensureIndexedTimer = setTimeout(() => {
      ensureIndexedTimer = undefined;
      void (async () => {
        const sidebar = runtime.sidebar;
        if (!sidebar) return;
        const status = await sidebar.ensureIndexed();
        sidebar.post({ type: 'index.status', index: status });
        await sidebar.refreshBootstrap();
      })().catch((error) => {
        channel.appendLine(
          `[index] scheduled ensure failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, delayMs);
  };
  context.subscriptions.push({
    dispose: () => {
      if (ensureIndexedTimer) clearTimeout(ensureIndexedTimer);
    },
  });

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

  const runtime: ActivationRuntime = {
    context,
    channel,
    debugEnabled,
    debugLog,
    workspaceRoot,
    workspaceId: () => workspaceId,
    ensureClient,
    invalidateClient,
    scheduleEnsureIndexed,
    sidebar: undefined,
    lastSessionExportPath: undefined,
    indexAbort: undefined,
  };
  return runtime;
}
