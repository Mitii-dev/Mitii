import { platform } from 'node:os';

import { resolveBubblewrapBackend } from '../adapters/bubblewrap/index.js';
import { resolveDockerBackend } from '../adapters/docker/index.js';
import { resolveSeatbeltBackend } from '../adapters/seatbelt/index.js';
import { unavailableBackend } from '../adapters/unavailable.js';
import { resolveWindowsBackend } from '../adapters/windows/index.js';
import type {
  SandboxBackend,
  SandboxBackendPrefer,
} from '../contracts/policy.js';
import {
  noopSandboxLogger,
  type SandboxLoggerPort,
} from '../ports/SandboxLoggerPort.js';

export function detectSandboxBackend(options?: {
  prefer?: SandboxBackendPrefer;
  logger?: SandboxLoggerPort;
}): SandboxBackend {
  const prefer = options?.prefer ?? 'auto';
  const logger = options?.logger ?? noopSandboxLogger;
  const backend = resolveBackend(prefer);

  logger.event({
    module: 'sandbox',
    stage: 'detect',
    level: backend.available ? 'debug' : 'warn',
    ...(backend.available
      ? {}
      : { reasonCodes: ['backend_missing'] as const }),
    details: {
      prefer,
      platform: platform(),
      backendId: backend.id,
      available: backend.available,
      reason: backend.reason,
    },
  });

  return backend;
}

function resolveBackend(prefer: SandboxBackendPrefer): SandboxBackend {
  if (prefer === 'docker') {
    return resolveDockerBackend('docker');
  }
  if (prefer === 'podman') {
    return resolveDockerBackend('podman');
  }
  if (prefer === 'seatbelt') {
    const seatbelt = resolveSeatbeltBackend();
    if (seatbelt.available) return seatbelt;
    return unavailableBackend(
      seatbelt.reason ?? 'macOS sandbox-exec unavailable',
    );
  }
  if (prefer === 'bubblewrap') {
    const bwrap = resolveBubblewrapBackend();
    if (bwrap.available) return bwrap;
    return unavailableBackend(bwrap.reason ?? 'Linux bwrap unavailable');
  }

  const os = platform();
  if (os === 'darwin') {
    const seatbelt = resolveSeatbeltBackend();
    if (seatbelt.available) return seatbelt;
    return unavailableBackend(
      seatbelt.reason ?? 'macOS sandbox-exec unavailable',
    );
  }
  if (os === 'linux') {
    const bwrap = resolveBubblewrapBackend();
    if (bwrap.available) return bwrap;
    const docker = resolveDockerBackend('docker');
    if (docker.available) return docker;
    const podman = resolveDockerBackend('podman');
    if (podman.available) return podman;
    return unavailableBackend(bwrap.reason ?? 'Linux bwrap unavailable');
  }
  if (os === 'win32') {
    return resolveWindowsBackend();
  }
  return unavailableBackend(`OS sandbox is not supported on ${os}`);
}
