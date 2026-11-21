import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';

import { registerApiKeyCommands } from './activation/apiKeyCommands.js';
import { registerEditorSync } from './activation/editorSync.js';
import { registerExportCommands } from './activation/exportCommands.js';
import {
  createIndexWorkspace,
  registerIndexingCommands,
  registerIndexingListeners,
} from './activation/indexing.js';
import { createActivationRuntime } from './activation/runtime.js';
import { registerSidebarCommands } from './activation/sidebarCommands.js';
import { registerWritingRecipeCommands } from './activation/writingRecipes.js';
import { showWriteDiffPreview } from './diff/diffPreview.js';
import { InlineDiffManager } from './diff/inlineDiffManager.js';
import { ReviewFindingsPresenter } from './review/reviewFindingsPresenter.js';
import { MitiiSidebarProvider } from './sidebar.js';

/**
 * VS Code host: activation composes @mitii/sdk and serves the React sidebar.
 * Command and listener registration lives under `./activation/`.
 */
export function activate(context: ExtensionContext): void {
  const rt = createActivationRuntime(context);
  const { channel } = rt;

  const inlineDiff = new InlineDiffManager(
    vscode,
    async (approvalId) => {
      rt.sidebar?.resolveInlineDiffDecision(approvalId, 'approved');
    },
    async (approvalId) => {
      rt.sidebar?.resolveInlineDiffDecision(approvalId, 'denied');
    },
  );
  context.subscriptions.push(inlineDiff);

  const reviewFindings = new ReviewFindingsPresenter(vscode, () =>
    rt.workspaceRoot(),
  );
  context.subscriptions.push(reviewFindings);

  const setInlineDiffContext = (pending: boolean): void => {
    void vscode.commands.executeCommand(
      'setContext',
      'mitii.inlineDiffPending',
      pending,
    );
  };

  const indexWorkspace = createIndexWorkspace(rt);

  const sidebar = new MitiiSidebarProvider(
    vscode,
    context.extensionUri,
    () => rt.ensureClient(),
    () => rt.workspaceRoot(),
    () => rt.workspaceId(),
    channel,
    context.secrets,
    () => rt.invalidateClient(),
    indexWorkspace,
    {
      extensionMode: context.extensionMode,
      workspaceState: context.workspaceState,
      inlineDiff,
      reviewFindings,
      onInlineDiffPending: setInlineDiffContext,
    },
  );
  rt.sidebar = sidebar;

  context.subscriptions.push(
    ...registerSidebarCommands(rt, sidebar, inlineDiff),
    ...registerIndexingCommands(rt, indexWorkspace),
    ...registerWritingRecipeCommands(rt),
    ...registerExportCommands(rt),
    ...registerApiKeyCommands(rt),
    ...registerEditorSync(rt, sidebar),
  );

  // Expose diff preview helper for sidebar without circular imports
  sidebar.attachHostHelpers({
    showWriteDiffPreview: async (relPath, content) => {
      const root = rt.workspaceRoot();
      if (!root) return;
      await showWriteDiffPreview(vscode, root, relPath, content);
    },
  });

  void rt
    .ensureClient()
    .then(async () => {
      channel.appendLine('[mitii] client composed OK');
      if (!rt.workspaceRoot()) return;
      const status = await sidebar.ensureIndexed();
      channel.appendLine(
        `[index] activation ${status.message ?? 'ready'} files=${status.fileCount}`,
      );
    })
    .catch((error) => {
      const detail =
        error instanceof Error
          ? rt.debugEnabled() && error.stack
            ? error.stack
            : error.message
          : String(error);
      channel.appendLine(`[mitii] client/index init deferred: ${detail}`);
      if (rt.debugEnabled()) channel.show(true);
    });

  context.subscriptions.push(...registerIndexingListeners(rt, sidebar));

  channel.appendLine('[mitii] activation complete');
}

export function deactivate(): void {
  // no-op
}
