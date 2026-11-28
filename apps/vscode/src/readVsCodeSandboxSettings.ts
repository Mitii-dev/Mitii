import type * as vscode from 'vscode';
import type { LiveSandboxSettingsReader } from '@mitii/host';

/** Map VS Code `mitii.safety.*` settings into the host live-sandbox reader. */
export function createVsCodeSandboxSettingsReader(
  vs: typeof vscode,
): LiveSandboxSettingsReader {
  return () => {
    const cfg = vs.workspace.getConfiguration('mitii');
    const configured = (key: string): boolean => {
      const value = cfg.inspect(key);
      return (
        value?.globalValue !== undefined ||
        value?.workspaceValue !== undefined ||
        value?.workspaceFolderValue !== undefined
      );
    };
    return {
      approvalMode: cfg.get<string>('safety.approvalMode') ?? 'guided',
      ...(configured('safety.sandbox.enabled')
        ? { enabled: cfg.get<boolean>('safety.sandbox.enabled') === true }
        : {}),
      ...(configured('safety.sandbox.network')
        ? { network: cfg.get<string>('safety.sandbox.network') ?? 'deny' }
        : {}),
    };
  };
}
