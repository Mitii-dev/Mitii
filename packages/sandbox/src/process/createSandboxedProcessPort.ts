/**
 * Ephemeral OS process sandbox.
 *
 * Wraps ProcessPort so approved commands still cannot write outside the
 * workspace or open arbitrary network (when network=deny).
 *
 * Default: disabled. When enabled on an unsupported platform or missing
 * backend binary, execution FAILS CLOSED (does not run unrestricted).
 */

import type { ProcessExecRequest, ProcessExecResult, ProcessPort } from '@mitii/v8';

import { formatSandboxFailClosed } from '../contracts/errors.js';
import type { SandboxBackend, SandboxPolicy } from '../contracts/policy.js';
import {
  noopSandboxLogger,
  type SandboxLoggerPort,
} from '../ports/SandboxLoggerPort.js';
import { detectSandboxBackend } from './detect.js';

export interface SandboxedProcessPort extends ProcessPort {
  readonly sandboxBackendId: SandboxBackend['id'];
  readonly sandboxEnabled: boolean;
}

export type CreateSandboxedProcessPortOptions = {
  inner: ProcessPort;
  policy: SandboxPolicy;
  backend?: SandboxBackend;
  logger?: SandboxLoggerPort;
};

/**
 * Wrap an inner ProcessPort with OS sandbox policy.
 * When policy.enabled is false, calls pass through unchanged.
 * When enabled and backend unavailable, fails closed.
 */
export function createSandboxedProcessPort(
  options: CreateSandboxedProcessPortOptions,
): SandboxedProcessPort;
export function createSandboxedProcessPort(
  inner: ProcessPort,
  policy: SandboxPolicy,
  backend?: SandboxBackend,
  logger?: SandboxLoggerPort,
): SandboxedProcessPort;
export function createSandboxedProcessPort(
  innerOrOptions: ProcessPort | CreateSandboxedProcessPortOptions,
  policy?: SandboxPolicy,
  backendArg?: SandboxBackend,
  loggerArg?: SandboxLoggerPort,
): SandboxedProcessPort {
  const isOptions =
    typeof innerOrOptions === 'object' &&
    innerOrOptions !== null &&
    'inner' in innerOrOptions &&
    'policy' in innerOrOptions;

  const options: CreateSandboxedProcessPortOptions = isOptions
    ? (innerOrOptions as CreateSandboxedProcessPortOptions)
    : {
        inner: innerOrOptions as ProcessPort,
        policy: policy!,
        ...(backendArg ? { backend: backendArg } : {}),
        ...(loggerArg ? { logger: loggerArg } : {}),
      };

  const { inner, policy: resolvedPolicy } = options;
  const logger = options.logger ?? noopSandboxLogger;
  const backend = options.backend ?? detectSandboxBackend();

  logger.event({
    module: 'sandbox',
    stage: 'process.wrap',
    level: 'debug',
    details: {
      enabled: resolvedPolicy.enabled,
      backendId: backend.id,
      backendAvailable: backend.available,
      network: resolvedPolicy.network,
      isolationProfile: resolvedPolicy.isolationProfile,
    },
  });

  return {
    sandboxBackendId: backend.id,
    sandboxEnabled: resolvedPolicy.enabled,
    execFile(request: ProcessExecRequest): Promise<ProcessExecResult> {
      if (!resolvedPolicy.enabled) {
        return inner.execFile(request);
      }
      if (!backend.available) {
        logger.event({
          module: 'sandbox',
          stage: 'process.fail_closed',
          level: 'warn',
          reasonCodes: ['sandbox_unavailable'],
          details: { backendId: backend.id, reason: backend.reason },
        });
        return Promise.resolve({
          exitCode: null,
          stdout: '',
          stderr: formatSandboxFailClosed(
            backend.reason ?? 'unavailable',
          ),
          timedOut: false,
          cancelled: false,
          truncated: false,
        });
      }
      try {
        const wrapped = backend.wrap(request, resolvedPolicy);
        return inner.execFile(wrapped);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.event({
          module: 'sandbox',
          stage: 'process.wrap_error',
          level: 'error',
          reasonCodes: ['wrap_failed'],
          details: { backendId: backend.id, message },
        });
        return Promise.resolve({
          exitCode: null,
          stdout: '',
          stderr: formatSandboxFailClosed(message),
          timedOut: false,
          cancelled: false,
          truncated: false,
        });
      }
    },
  };
}
