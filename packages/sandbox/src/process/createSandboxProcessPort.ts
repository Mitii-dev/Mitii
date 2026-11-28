import type { ProcessPort } from '@mitii/v8';

import type {
  SandboxBackend,
  SandboxBackendPrefer,
  SandboxPolicy,
} from '../contracts/policy.js';
import type { SandboxLifecycleMode } from '../constants.js';
import {
  createSessionSandboxedProcessPort,
  type SessionSandboxedProcessPort,
} from '../lifecycle/createSessionSandboxedProcessPort.js';
import {
  noopSandboxLogger,
  type SandboxLoggerPort,
} from '../ports/SandboxLoggerPort.js';
import {
  createSandboxedProcessPort,
  type SandboxedProcessPort,
} from './createSandboxedProcessPort.js';
import { detectSandboxBackend } from './detect.js';

export type CreateSandboxProcessPortOptions = {
  inner: ProcessPort;
  policy: SandboxPolicy;
  prefer?: SandboxBackendPrefer;
  lifecycle?: SandboxLifecycleMode;
  sessionKey?: string;
  /** Ephemeral only — ignored for session lifecycle. */
  backend?: SandboxBackend;
  logger?: SandboxLoggerPort;
};

/**
 * Package entry for OS-sandboxed ProcessPort.
 * - ephemeral (default): wrap each exec (seatbelt / bwrap / docker run --rm)
 * - session: long-lived docker/podman container + exec
 */
export function createSandboxProcessPort(
  options: CreateSandboxProcessPortOptions,
): SandboxedProcessPort | SessionSandboxedProcessPort {
  const logger = options.logger ?? noopSandboxLogger;
  const lifecycle = options.lifecycle ?? 'ephemeral';

  logger.event({
    module: 'sandbox',
    stage: 'process.create',
    level: 'info',
    details: {
      lifecycle,
      enabled: options.policy.enabled,
      prefer: options.prefer ?? 'auto',
    },
  });

  if (lifecycle === 'session') {
    return createSessionSandboxedProcessPort({
      inner: options.inner,
      policy: options.policy,
      prefer: options.prefer ?? 'auto',
      sessionKey: options.sessionKey,
      logger,
    });
  }

  return createSandboxedProcessPort({
    inner: options.inner,
    policy: options.policy,
    backend:
      options.backend ??
      detectSandboxBackend({
        prefer: options.prefer ?? 'auto',
        logger,
      }),
    logger,
  });
}

/** @deprecated Prefer {@link createSandboxProcessPort}. */
export type CreateHostSandboxProcessPortOptions = CreateSandboxProcessPortOptions;

/** @deprecated Prefer {@link createSandboxProcessPort}. */
export const createHostSandboxProcessPort = createSandboxProcessPort;
