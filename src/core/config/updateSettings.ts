import * as vscode from 'vscode';
import type { ProviderSettingsPayload } from '../../vscode/webview/messages';

const CONFIG_SECTION = 'thunder';

export async function updateProviderSettings(settings: ProviderSettingsPayload): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const target = vscode.ConfigurationTarget.Global;

  await config.update('provider.type', settings.providerType, target);
  await config.update('provider.baseUrl', settings.baseUrl.trim(), target);
  await config.update('provider.model', settings.model.trim(), target);
  await config.update('provider.contextWindow', settings.contextWindow, target);
}

export async function updateWorkspaceOverride(path: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update('workspace.rootPathOverride', path.trim(), vscode.ConfigurationTarget.Global);
}

export async function clearWorkspaceOverride(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update('workspace.rootPathOverride', '', vscode.ConfigurationTarget.Global);
}
