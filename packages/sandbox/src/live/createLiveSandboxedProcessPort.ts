import type { ProcessExecRequest, ProcessPort } from '@mitii/v8';

import type { SandboxBackend, SandboxNetworkMode } from '../contracts/policy.js';
import { resolveSandboxSettingsFromPreset } from '../defaults.js';
import { buildSandboxPolicy } from '../policy/buildSandboxPolicy.js';
import type { SandboxGrantScopesInput } from '../policy/projectGrantToOsPolicy.js';
import type { SandboxLoggerPort } from '../ports/SandboxLoggerPort.js';
import { createSandboxedProcessPort } from '../process/createSandboxedProcessPort.js';

export type LiveSandboxSettings = {
  enabled: boolean;
  network: SandboxNetworkMode;
};

/**
 * Host-supplied reader for live sandbox settings (approval mode + explicit
 * enabled/network overrides). Apps map their settings UI into this shape.
 */
export type LiveSandboxSettingsReader = () => {
  approvalMode?: string;
  /** Set only when the host has an explicit enabled preference. */
  enabled?: boolean;
  /** Set only when the host has an explicit network preference. */
  network?: string;
};

export type LiveSandboxPolicyOptions = {
  scopes?: SandboxGrantScopesInput;
  /** Extra protected relative/absolute paths (e.g. from host safety.json). */
  protectedPathGlobs?: readonly string[];
  applyDefaultDenyReadPaths?: boolean;
  logger?: SandboxLoggerPort;
};

function settingsKey(settings: LiveSandboxSettings): string {
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
  readSettings: LiveSandboxSettingsReader,
  inner: ProcessPort,
  workspaceRoot: string,
  backend: SandboxBackend,
  policyOptions?: LiveSandboxPolicyOptions,
): ProcessPort {
  let cachedKey: string | undefined;
  let cachedPort: ProcessPort | undefined;
  let sandboxLatchedOn = false;

  const resolvePort = (): ProcessPort => {
    const raw = readSettings();
    const fromPreset = resolveSandboxSettingsFromPreset({
      approvalMode: raw.approvalMode,
      ...(raw.enabled !== undefined ? { enabled: raw.enabled } : {}),
      ...(raw.network !== undefined ? { network: raw.network } : {}),
    });
    const settings: LiveSandboxSettings = {
      enabled: fromPreset.enabled || sandboxLatchedOn,
      network: fromPreset.network,
    };
    if (settings.enabled) sandboxLatchedOn = true;

    const key = settingsKey(settings);
    if (cachedPort && cachedKey === key) return cachedPort;

    cachedKey = key;
    cachedPort = createSandboxedProcessPort({
      inner,
      policy: buildSandboxPolicy({
        workspaceRoot,
        enabled: settings.enabled,
        network: settings.network,
        ...(policyOptions?.scopes ? { scopes: policyOptions.scopes } : {}),
        ...(policyOptions?.protectedPathGlobs
          ? { protectedPathGlobs: policyOptions.protectedPathGlobs }
          : {}),
        ...(policyOptions?.applyDefaultDenyReadPaths !== undefined
          ? {
              applyDefaultDenyReadPaths:
                policyOptions.applyDefaultDenyReadPaths,
            }
          : {}),
      }),
      backend,
      ...(policyOptions?.logger ? { logger: policyOptions.logger } : {}),
    });
    return cachedPort;
  };

  return {
    execFile(request: ProcessExecRequest) {
      return resolvePort().execFile(request);
    },
  };
}
