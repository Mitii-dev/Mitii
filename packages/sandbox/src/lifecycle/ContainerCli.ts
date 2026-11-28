import type { ProcessExecRequest, ProcessExecResult, ProcessPort } from '@mitii/v8';

import type { ContainerRuntimeKind } from './contracts.js';

export type ContainerCliRunOptions = {
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
};

/**
 * Thin host-side CLI for docker/podman. Runs on the host ProcessPort
 * (not inside the sandbox). Injectable for tests.
 */
export interface ContainerCli {
  readonly runtime: ContainerRuntimeKind;
  run(
    argvTail: readonly string[],
    options?: ContainerCliRunOptions,
  ): Promise<ProcessExecResult>;
}

export function createContainerCli(
  inner: ProcessPort,
  runtime: ContainerRuntimeKind,
): ContainerCli {
  return {
    runtime,
    run(argvTail, options = {}) {
      const request: ProcessExecRequest = {
        argv: [runtime, ...argvTail],
        cwd: options.cwd ?? '/',
        timeoutMs: options.timeoutMs ?? 60_000,
        maxOutputBytes: options.maxOutputBytes ?? 256_000,
        ...(options.env ? { env: options.env } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      };
      return inner.execFile(request);
    },
  };
}
