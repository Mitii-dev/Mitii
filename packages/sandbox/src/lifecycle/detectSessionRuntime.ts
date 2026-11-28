import { commandExists } from '../helpers/commandExists.js';
import type { SandboxBackendPrefer } from '../contracts/policy.js';
import type { ContainerRuntimeKind } from './contracts.js';

export type SessionRuntimeResolution =
  | { available: true; runtime: ContainerRuntimeKind }
  | { available: false; reason: string };

/**
 * Session lifecycle requires docker or podman. Seatbelt/bubblewrap cannot
 * host a long-lived session container — fail closed when those are preferred.
 */
export function detectSessionContainerRuntime(
  prefer: SandboxBackendPrefer = 'auto',
): SessionRuntimeResolution {
  if (prefer === 'seatbelt' || prefer === 'bubblewrap') {
    return {
      available: false,
      reason: `session lifecycle requires docker or podman (prefer=${prefer})`,
    };
  }
  if (prefer === 'docker') {
    return commandExists('docker')
      ? { available: true, runtime: 'docker' }
      : { available: false, reason: 'docker not found on PATH' };
  }
  if (prefer === 'podman') {
    return commandExists('podman')
      ? { available: true, runtime: 'podman' }
      : { available: false, reason: 'podman not found on PATH' };
  }
  if (commandExists('docker')) {
    return { available: true, runtime: 'docker' };
  }
  if (commandExists('podman')) {
    return { available: true, runtime: 'podman' };
  }
  return {
    available: false,
    reason:
      'session lifecycle requires docker or podman on PATH (including Windows)',
  };
}
