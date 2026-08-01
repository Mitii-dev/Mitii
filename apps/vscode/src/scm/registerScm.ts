import type * as vscode from 'vscode';

import { setGitCommitInputBox } from './scmInputBoxBridge.js';

/**
 * Run commit-message generation with notification progress + ephemeral status bar.
 * Prefers Git SCM input box; falls back to clipboard.
 */
export async function runCommitMessageWithScmUi(options: {
  vs: typeof vscode;
  workspaceRoot: string;
  generate: () => Promise<string>;
}): Promise<void> {
  const { vs, workspaceRoot, generate } = options;
  const status = vs.window.createStatusBarItem(vs.StatusBarAlignment.Left, 1000);
  status.name = 'Mitii commit message generation';
  status.text = '$(sync~spin) Mitii generating commit message';
  status.tooltip =
    'Mitii is reading staged changes and asking the model for a commit message.';
  status.show();
  try {
    await vs.window.withProgress(
      {
        location: vs.ProgressLocation.Notification,
        title: 'Mitii: Generating commit message',
        cancellable: false,
      },
      async (progress) => {
        progress.report({
          message: 'Reading staged changes and recent commits…',
        });
        const fullMessage = await generate();
        progress.report({ message: 'Writing message to Source Control…' });
        const applied = await setGitCommitInputBox(
          vs,
          workspaceRoot,
          fullMessage,
        );
        if (!applied) {
          await vs.env.clipboard.writeText(fullMessage);
          void vs.window.showWarningMessage(
            'Mitii: Could not find the Git input box, so the commit message was copied to clipboard.',
          );
          return;
        }
        void vs.window.showInformationMessage(
          'Mitii: Commit message added to Source Control.',
        );
      },
    );
  } finally {
    status.dispose();
  }
}
