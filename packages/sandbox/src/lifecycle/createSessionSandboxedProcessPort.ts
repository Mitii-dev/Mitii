import type { ProcessExecRequest, ProcessExecResult, ProcessPort } from '@mitii/v8';

import { formatSandboxFailClosed } from '../contracts/errors.js';
import type { SandboxBackendPrefer, SandboxPolicy } from '../contracts/policy.js';
import {
  noopSandboxLogger,
  type SandboxLoggerPort,
} from '../ports/SandboxLoggerPort.js';
import type { SandboxedProcessPort } from '../process/createSandboxedProcessPort.js';
import { createContainerCli, type ContainerCli } from './ContainerCli.js';
import type { SandboxSessionInfo } from './contracts.js';
import { detectSessionContainerRuntime } from './detectSessionRuntime.js';
import { SessionContainer } from './SessionContainer.js';

export interface SessionSandboxedProcessPort extends SandboxedProcessPort {
  readonly lifecycle: 'session';
  readonly containerName: string;
  status(): Promise<SandboxSessionInfo>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  destroy(): Promise<void>;
}

export type CreateSessionSandboxedProcessPortOptions = {
  inner: ProcessPort;
  policy: SandboxPolicy;
  prefer?: SandboxBackendPrefer;
  sessionKey?: string;
  /** Inject for tests; when omitted, built from inner + detected runtime. */
  cli?: ContainerCli;
  logger?: SandboxLoggerPort;
};

/**
 * Long-lived container sandbox: one container per workspace/session key,
 * `exec` for each process call. Fail-closed when docker/podman unavailable.
 */
export function createSessionSandboxedProcessPort(
  options: CreateSessionSandboxedProcessPortOptions,
): SessionSandboxedProcessPort {
  const { inner, policy } = options;
  const logger = options.logger ?? noopSandboxLogger;
  const resolution = options.cli
    ? ({ available: true, runtime: options.cli.runtime } as const)
    : detectSessionContainerRuntime(options.prefer ?? 'auto');

  const cli =
    options.cli ??
    (resolution.available
      ? createContainerCli(inner, resolution.runtime)
      : undefined);

  const session =
    cli && policy.enabled
      ? new SessionContainer({
          cli,
          policy,
          sessionKey: options.sessionKey,
        })
      : undefined;

  const backendId = cli?.runtime ?? 'unavailable';

  logger.event({
    module: 'sandbox',
    stage: 'session.create',
    level: 'info',
    details: {
      enabled: policy.enabled,
      backendId,
      available: Boolean(session),
      reason: resolution.available ? undefined : resolution.reason,
    },
  });

  const fail = (message: string): ProcessExecResult => ({
    exitCode: null,
    stdout: '',
    stderr: formatSandboxFailClosed(message),
    timedOut: false,
    cancelled: false,
    truncated: false,
  });

  return {
    lifecycle: 'session',
    sandboxBackendId: backendId,
    sandboxEnabled: policy.enabled,
    containerName:
      session?.containerName ?? `mitii-sandbox-unavailable`,
    execFile(request: ProcessExecRequest): Promise<ProcessExecResult> {
      if (!policy.enabled) {
        return inner.execFile(request);
      }
      if (!session) {
        logger.event({
          module: 'sandbox',
          stage: 'session.fail_closed',
          level: 'warn',
          reasonCodes: ['sandbox_unavailable'],
          details: {
            reason: resolution.available
              ? 'session container not initialized'
              : resolution.reason,
          },
        });
        return Promise.resolve(
          fail(
            resolution.available
              ? 'session container not initialized'
              : resolution.reason,
          ),
        );
      }
      return session.exec(request).catch((error) => {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.event({
          module: 'sandbox',
          stage: 'session.exec_error',
          level: 'error',
          reasonCodes: ['wrap_failed'],
          details: { message },
        });
        return fail(message);
      });
    },
    async status() {
      if (!session) {
        return {
          containerName: 'mitii-sandbox-unavailable',
          runtime: 'docker',
          status: 'missing' as const,
          workspaceRoot: policy.workspaceRoot,
        };
      }
      return session.status();
    },
    async pause() {
      if (!session) {
        throw new Error(formatSandboxFailClosed('session unavailable'));
      }
      logger.event({
        module: 'sandbox',
        stage: 'session.pause',
        level: 'info',
        details: { containerName: session.containerName },
      });
      await session.pause();
    },
    async resume() {
      if (!session) {
        throw new Error(formatSandboxFailClosed('session unavailable'));
      }
      logger.event({
        module: 'sandbox',
        stage: 'session.resume',
        level: 'info',
        details: { containerName: session.containerName },
      });
      await session.resume();
    },
    async destroy() {
      if (!session) return;
      logger.event({
        module: 'sandbox',
        stage: 'session.destroy',
        level: 'info',
        details: { containerName: session.containerName },
      });
      await session.destroy();
    },
  };
}
