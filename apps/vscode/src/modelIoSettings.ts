import type * as vscode from 'vscode';

/**
 * Model I/O dump toggle.
 *
 * Must NOT live under `mitii.debug.*` — `mitii.debug` is a boolean leaf, so
 * nested keys like `mitii.debug.modelIo` cannot be read reliably in VS Code.
 */
export function readModelIoLoggingEnabled(
  cfg: vscode.WorkspaceConfiguration,
): boolean {
  const current = cfg.get<boolean>('developer.modelIo');
  if (typeof current === 'boolean') return current;
  // Legacy key from the first ship (broken under boolean mitii.debug).
  const legacy = cfg.get<boolean>('debug.modelIo');
  return legacy === true;
}
