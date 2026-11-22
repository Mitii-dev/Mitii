import * as vscode from 'vscode';

import type { InlineDiffManager } from '../diff/inlineDiffManager.js';
import { restoreCheckpointCommand } from '../restoreCheckpoint.js';
import { MitiiSidebarProvider } from '../sidebar.js';
import type { ActivationRuntime } from './runtime.js';

/** Sidebar view registration plus chat / review / diff / settings commands. */
export function registerSidebarCommands(
  rt: ActivationRuntime,
  sidebar: MitiiSidebarProvider,
  inlineDiff: InlineDiffManager,
): vscode.Disposable[] {
  const { context } = rt;
  const workspaceRoot = (): string | undefined => rt.workspaceRoot();

  const openChat = async (): Promise<void> => {
    await vscode.commands.executeCommand('mitii.sidebar.focus');
    sidebar.post({ type: 'setTab', tab: 'chat' });
  };

  const reviewChanges = async (): Promise<void> => {
    await vscode.commands.executeCommand('mitii.sidebar.focus');
    // Show git changes only — LLM Code Review is the separate bar button.
    sidebar.post({ type: 'startReview', autoRun: false });
  };

  return [
    vscode.window.registerWebviewViewProvider(
      MitiiSidebarProvider.viewType,
      sidebar,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('mitii.openChat', openChat),
    vscode.commands.registerCommand('mitii.reviewChanges', reviewChanges),
    vscode.commands.registerCommand('mitii.restoreCheckpoint', async () => {
      await restoreCheckpointCommand(vscode, context.secrets);
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
    vscode.commands.registerCommand('mitii.showSettings', async () => {
      await vscode.commands.executeCommand('mitii.sidebar.focus');
      sidebar.post({ type: 'openSettings', tab: 'model' });
    }),
  ];
}
