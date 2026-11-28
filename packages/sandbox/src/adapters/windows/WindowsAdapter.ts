import { resolveDockerBackend } from '../docker/index.js';
import { unavailableBackend } from '../unavailable.js';
import type { SandboxBackend } from '../../contracts/policy.js';

/**
 * Windows OS sandbox: docker or podman (Linux containers).
 * Native Job Object / AppContainer isolation is not implemented — fail closed
 * when neither container runtime is on PATH.
 */
export function resolveWindowsBackend(): SandboxBackend {
  const docker = resolveDockerBackend('docker');
  if (docker.available) {
    return docker;
  }
  const podman = resolveDockerBackend('podman');
  if (podman.available) {
    return podman;
  }
  return unavailableBackend(
    'Windows OS sandbox requires docker or podman on PATH (native job isolation is not available)',
  );
}
