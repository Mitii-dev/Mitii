import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import type { MitiiClient } from '@mitii/sdk';
import {
  buildWritingRecipeAsk,
  type MitiiWritingRecipeId,
  unwrapRecipeAnswer,
} from '@mitii/host';

import { runAskInOutputChannel } from '../hostAsk.js';
import { runCommitMessageWithScmUi } from '../scm/registerScm.js';
import type { ActivationRuntime } from './runtime.js';

/** Commit message, PR summary, changelog, and release-notes recipes. */
export function registerWritingRecipeCommands(
  rt: ActivationRuntime,
): vscode.Disposable[] {
  const { context, channel } = rt;
  const workspaceRoot = (): string | undefined => rt.workspaceRoot();
  const ensureClient = (): Promise<MitiiClient> => rt.ensureClient();

  const runWritingRecipe = async (
    recipeId: MitiiWritingRecipeId,
    options?: { userNote?: string; writeFileName?: string },
  ): Promise<string | undefined> => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a git folder first.');
      return undefined;
    }
    const style =
      vscode.workspace
        .getConfiguration('mitii')
        .get<string>('scm.commitMessageStyle') ?? 'conventional';
    const ask = await buildWritingRecipeAsk({
      workspaceRoot: root,
      recipe: recipeId,
      commitMessageStyle:
        style === 'plain' ? 'plain' : 'conventional',
      userNote: options?.userNote,
    });
    const c = await ensureClient();
    const outcome = await runAskInOutputChannel({
      vs: vscode,
      client: c,
      prompt: ask.prompt,
      workspaceRoot: root,
      channel,
      mode: ask.mode,
      requiredSkillIds: ask.requiredSkillIds,
      workspaceId: rt.workspaceId(),
      workspaceState: context.workspaceState,
      secrets: context.secrets,
    });
    const answer = outcome.result.answer?.trim();
    const cleaned = answer ? unwrapRecipeAnswer(answer) : undefined;
    if (options?.writeFileName && cleaned) {
      const outPath = join(root, '.mitii', options.writeFileName);
      mkdirSync(join(root, '.mitii'), { recursive: true });
      writeFileSync(outPath, `${cleaned}\n`);
      const doc = await vscode.workspace.openTextDocument(outPath);
      await vscode.window.showTextDocument(doc);
    }
    return cleaned;
  };

  const generateCommitMessage = async (): Promise<void> => {
    const root = workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a git folder first.');
      return;
    }
    try {
      await runCommitMessageWithScmUi({
        vs: vscode,
        workspaceRoot: root,
        generate: async () => {
          const answer = await runWritingRecipe('commit-message');
          return answer || 'chore: update workspace';
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Mitii: ${message}`);
    }
  };

  return [
    vscode.commands.registerCommand(
      'mitii.generateCommitMessage',
      generateCommitMessage,
    ),
    vscode.commands.registerCommand('mitii.generatePrSummary', async () => {
      try {
        const answer = await runWritingRecipe('pr-summary', {
          writeFileName: 'PR-SUMMARY-draft.md',
        });
        if (!answer) {
          void vscode.window.showWarningMessage(
            'Mitii: No PR summary returned — check provider settings.',
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Mitii: ${message}`);
      }
    }),
    vscode.commands.registerCommand('mitii.generateChangelog', async () => {
      try {
        const answer = await runWritingRecipe('changelog', {
          writeFileName: 'CHANGELOG-draft.md',
        });
        if (!answer) {
          void vscode.window.showWarningMessage(
            'Mitii: No changelog returned — check provider settings.',
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Mitii: ${message}`);
      }
    }),
    vscode.commands.registerCommand('mitii.prepareRelease', async () => {
      try {
        const answer = await runWritingRecipe('changelog', {
          userNote:
            'Frame as release notes: summary highlights, breaking changes, and upgrade notes inside the Keep a Changelog section.',
          writeFileName: 'RELEASE-NOTES-draft.md',
        });
        if (!answer) {
          void vscode.window.showWarningMessage(
            'Mitii: No release notes returned — check provider settings.',
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Mitii: ${message}`);
      }
    }),
  ];
}
