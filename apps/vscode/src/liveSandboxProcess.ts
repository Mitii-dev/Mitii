import type * as vscode from 'vscode';
import type { ProcessPort, ProcessExecRequest } from '@mitii/v8';
import {
  createSandboxedProcessPort,
  resolveSandboxPolicy,
  resolveSandboxSettingsFromPreset,
  type SandboxBackend,
  type SandboxNetworkMode,
} from '@mitii/host';

type ResolvedSandboxSettings = {
  enabled: boolean;
  network: SandboxNetworkMode;
};

function readSandboxSettings(vs: typeof vscode): ResolvedSandboxSettings {
  const cfg = vs.workspace.getConfiguration('mitii');
  const configured = (key: string): boolean => {
    const value = cfg.inspect(key);
    return (
      value?.globalValue !== undefined ||
      value?.workspaceValue !== undefined ||
      value?.workspaceFolderValue !== undefined
    );
  };
  return resolveSandboxSettingsFromPreset({
    approvalMode: cfg.get<string>('safety.approvalMode') ?? 'guided',
    ...(configured('safety.sandbox.enabled')
      ? { enabled: cfg.get<boolean>('safety.sandbox.enabled') === true }
      : {}),
    ...(configured('safety.sandbox.network')
      ? { network: cfg.get<string>('safety.sandbox.network') ?? 'deny' }
      : {}),
  });
}

function settingsKey(settings: ResolvedSandboxSettings): string {
  return `${settings.enabled ? 1 : 0}:${settings.network}`;
}

/**
 * Process port that refreshes access policy when settings change, without
 * rebuilding a wrapper on every exec.
 *
 * Once sandbox has been enabled for this port, it cannot be disabled through
 * live settings (fail closed). Network may still tighten/loosen with approval
 * mode so Guided ↔ Full access keeps working mid-session.
 */
export function createLiveSandboxedProcessPort(
  vs: typeof vscode,
  inner: ProcessPort,
  workspaceRoot: string,
  backend: SandboxBackend,
): ProcessPort {
  let cachedKey: string | undefined;
  let cachedPort: ProcessPort | undefined;
  let sandboxLatchedOn = false;

  const resolvePort = (): ProcessPort => {
    const raw = readSandboxSettings(vs);
    const settings: ResolvedSandboxSettings = {
      // Latch: after sandbox has run enabled, ignore live disable.
      enabled: raw.enabled || sandboxLatchedOn,
      network: raw.network,
    };
    if (settings.enabled) sandboxLatchedOn = true;

    const key = settingsKey(settings);
    if (cachedPort && cachedKey === key) return cachedPort;

    cachedKey = key;
    cachedPort = createSandboxedProcessPort(
      inner,
      resolveSandboxPolicy({ ...settings, workspaceRoot }),
      backend,
    );
    return cachedPort;
  };

  return {
    execFile(request: ProcessExecRequest) {
      return resolvePort().execFile(request);
    },
  };
}
