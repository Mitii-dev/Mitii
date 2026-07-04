import * as vscode from 'vscode';
import { AGENT_NAME } from '../shared/brand';

export interface NativeModuleHealthResult {
  ok: boolean;
  moduleName: string;
  message: string;
  rebuildCommand: string;
}

export function checkBetterSqliteHealth(): NativeModuleHealthResult {
  const rebuildCommand = detectEditorRebuildCommand();
  try {
    require('better-sqlite3');
    return {
      ok: true,
      moduleName: 'better-sqlite3',
      message: 'better-sqlite3 loaded successfully.',
      rebuildCommand,
    };
  } catch (error) {
    return {
      ok: false,
      moduleName: 'better-sqlite3',
      message: error instanceof Error ? error.message : String(error),
      rebuildCommand,
    };
  }
}

export async function notifyNativeModuleHealth(result = checkBetterSqliteHealth()): Promise<void> {
  if (result.ok) return;

  const action = 'Copy rebuild command';
  const choice = await vscode.window.showWarningMessage(
    `${AGENT_NAME}: ${result.moduleName} failed to load. Rebuild native modules for this editor runtime.`,
    action
  );
  if (choice === action) {
    await vscode.env.clipboard.writeText(result.rebuildCommand);
    void vscode.window.showInformationMessage(`${AGENT_NAME}: copied ${result.rebuildCommand}`);
  }
}

export function detectEditorRebuildCommand(env: NodeJS.ProcessEnv = process.env): string {
  const editor = (env.MITII_EDITOR || env.THUNDER_EDITOR || env.VSCODE_PID || '').toString().toLowerCase();
  if (editor.includes('cursor') || env.CURSOR_TRACE_ID || env.CURSOR_APP_NAME) {
    return 'MITII_EDITOR=cursor npm run rebuild:native';
  }
  return 'npm run rebuild:native';
}
