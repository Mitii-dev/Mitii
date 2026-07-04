import * as vscode from 'vscode';
import { CONFIG_SECTION, LEGACY_CONFIG_SECTION } from '../keys';

export interface SettingsMigrationResult {
  copied: string[];
  skipped: string[];
}

export async function migrateThunderSettingsToMitii(
  paths: string[],
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<SettingsMigrationResult> {
  const current = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const legacy = vscode.workspace.getConfiguration(LEGACY_CONFIG_SECTION);
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const path of paths) {
    const legacyInspect = legacy.inspect(path);
    if (!hasConfiguredValue(legacyInspect)) {
      skipped.push(path);
      continue;
    }
    if (hasConfiguredValue(current.inspect(path))) {
      skipped.push(path);
      continue;
    }
    await current.update(path, legacy.get(path), target);
    copied.push(path);
  }

  return { copied, skipped };
}

function hasConfiguredValue(inspect: ReturnType<vscode.WorkspaceConfiguration['inspect']>): boolean {
  if (!inspect) return false;
  return [
    inspect.globalValue,
    inspect.workspaceValue,
    inspect.workspaceFolderValue,
    inspect.globalLanguageValue,
    inspect.workspaceLanguageValue,
    inspect.workspaceFolderLanguageValue,
  ].some((value) => value !== undefined);
}
