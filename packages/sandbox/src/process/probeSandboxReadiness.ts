import { platform } from 'node:os';

import type { SandboxLifecycleMode } from '../constants.js';
import type {
  SandboxBackendId,
  SandboxBackendPrefer,
} from '../contracts/policy.js';
import { detectSandboxBackend } from './detect.js';
import { detectSessionContainerRuntime } from '../lifecycle/detectSessionRuntime.js';

export type SandboxReadiness = {
  enabled: boolean;
  lifecycle: SandboxLifecycleMode;
  prefer: SandboxBackendPrefer;
  platform: NodeJS.Platform;
  backendId: SandboxBackendId;
  available: boolean;
  reason?: string;
  /** True when docker/podman can host a session container. */
  sessionSupported: boolean;
  sessionReason?: string;
};

/**
 * Probe whether the OS sandbox can run for the given host options.
 * Safe for settings UI — does not start containers.
 */
export function probeSandboxReadiness(options?: {
  enabled?: boolean;
  prefer?: SandboxBackendPrefer;
  lifecycle?: SandboxLifecycleMode;
}): SandboxReadiness {
  const enabled = options?.enabled === true;
  const prefer = options?.prefer ?? 'auto';
  const lifecycle = options?.lifecycle ?? 'ephemeral';
  const backend = detectSandboxBackend({ prefer });
  const session = detectSessionContainerRuntime(prefer);

  const available =
    lifecycle === 'session' ? session.available : backend.available;
  const backendId: SandboxBackendId =
    lifecycle === 'session'
      ? session.available
        ? session.runtime
        : 'unavailable'
      : backend.id;
  const reason =
    lifecycle === 'session'
      ? session.available
        ? undefined
        : session.reason
      : backend.available
        ? undefined
        : backend.reason;

  return {
    enabled,
    lifecycle,
    prefer,
    platform: platform(),
    backendId,
    available,
    ...(reason ? { reason } : {}),
    sessionSupported: session.available,
    ...(session.available ? {} : { sessionReason: session.reason }),
  };
}
