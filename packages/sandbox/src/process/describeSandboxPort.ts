import type { ProcessPort } from '@mitii/v8';

import type { SandboxBackendId } from '../contracts/policy.js';
import type { SandboxLifecycleMode } from '../constants.js';
import { isSessionSandboxedProcessPort } from './isSessionSandboxedProcessPort.js';

export type SandboxPortDescription = {
  sandboxEnabled: boolean | null;
  sandboxBackendId: SandboxBackendId | null;
  lifecycle: SandboxLifecycleMode | 'unknown';
  containerName?: string;
};

/**
 * Compact sandbox fields for session logs / diagnostics.
 * Never includes env values or secrets.
 */
export function describeSandboxPort(
  port: ProcessPort | undefined,
): SandboxPortDescription {
  if (!port) {
    return {
      sandboxEnabled: null,
      sandboxBackendId: null,
      lifecycle: 'unknown',
    };
  }
  const enabled =
    'sandboxEnabled' in port && typeof (port as { sandboxEnabled?: unknown }).sandboxEnabled === 'boolean'
      ? (port as { sandboxEnabled: boolean }).sandboxEnabled
      : null;
  const backendId =
    'sandboxBackendId' in port &&
    typeof (port as { sandboxBackendId?: unknown }).sandboxBackendId === 'string'
      ? ((port as { sandboxBackendId: SandboxBackendId }).sandboxBackendId)
      : null;

  if (isSessionSandboxedProcessPort(port)) {
    return {
      sandboxEnabled: enabled,
      sandboxBackendId: backendId ?? port.sandboxBackendId,
      lifecycle: 'session',
      containerName: port.containerName,
    };
  }

  return {
    sandboxEnabled: enabled,
    sandboxBackendId: backendId,
    lifecycle: enabled === null && backendId === null ? 'unknown' : 'ephemeral',
  };
}
