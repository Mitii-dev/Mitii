import * as vscode from 'vscode';
import { ThunderController } from '../core/app/ThunderController';
import { ThunderWebviewProvider } from './webview/ThunderWebviewProvider';
import { registerScmContributions } from './scm/registerScmContributions';
import { migrateThunderSettingsToMitii } from '../core/config/vscode/migrate';
import { MITII_SETTING_PATHS } from '../core/config/settingPaths';

export function registerCommands(
  context: vscode.ExtensionContext,
  controller: ThunderController,
  webviewProvider: ThunderWebviewProvider
): void {
  context.subscriptions.push(
    registerCommandAlias('thunder.openChat', 'mitii.openChat', async () => {
      await vscode.commands.executeCommand('thunder.sidebar.focus');
      webviewProvider.showChat();
    }),

    registerCommandAlias('thunder.indexWorkspace', 'mitii.indexWorkspace', async () => {
      await controller.indexWorkspace();
    }),

    registerCommandAlias('thunder.showSettings', 'mitii.showSettings', async () => {
      await vscode.commands.executeCommand('thunder.sidebar.focus');
      webviewProvider.showSettings();
    }),

    registerCommandAlias('thunder.exportSessionLog', 'mitii.exportSessionLog', async () => {
      await controller.exportSessionLog();
    }),

    registerCommandAlias('thunder.exportAuditPack', 'mitii.exportAuditPack', async () => {
      await controller.exportAuditPack();
    }),

    registerCommandAlias('thunder.openSessionLog', 'mitii.openSessionLog', async () => {
      await controller.openSessionLog();
    }),

    registerCommandAlias('thunder.generateChangelog', 'mitii.generateChangelog', async () => {
      await controller.generateChangelog();
    }),

    registerCommandAlias('thunder.prepareRelease', 'mitii.prepareRelease', async () => {
      await controller.prepareRelease();
    }),

    registerCommandAlias('thunder.showInlineDiff', 'mitii.showInlineDiff', async (approvalId?: string) => {
      if (typeof approvalId === 'string') {
        await controller.showInlineDiffForApproval(approvalId);
      }
    }),

    vscode.commands.registerCommand('mitii.migrateThunderSettings', async () => {
      const result = await migrateThunderSettingsToMitii([...MITII_SETTING_PATHS]);
      await vscode.window.showInformationMessage(
        `Mitii settings migration copied ${result.copied.length} setting${result.copied.length === 1 ? '' : 's'}.`
      );
    })
  );

  registerScmContributions(context, controller);
}

function registerCommandAlias(
  legacyCommand: string,
  mitiiCommand: string,
  handler: (...args: any[]) => unknown
): vscode.Disposable {
  const legacy = vscode.commands.registerCommand(legacyCommand, handler);
  const current = vscode.commands.registerCommand(mitiiCommand, handler);
  return {
    dispose() {
      legacy.dispose();
      current.dispose();
    },
  };
}
