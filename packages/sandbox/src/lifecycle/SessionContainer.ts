import type { ProcessExecRequest, ProcessExecResult } from '@mitii/v8';

import {
  buildContainerIsolationArgs,
  resolveSandboxImage,
} from '../adapters/docker/containerArgs.js';
import { SESSION_CONTAINER_KEEPALIVE } from '../constants.js';
import { formatSandboxFailClosed } from '../contracts/errors.js';
import { SandboxUnavailableError } from '../contracts/errors.js';
import type { SandboxPolicy } from '../contracts/policy.js';
import { mapCwdToContainer, toContainerPath } from '../helpers/containerPaths.js';
import { scrubSandboxedEnv } from '../helpers/envScrub.js';

import type { ContainerCli } from './ContainerCli.js';
import type {
  SandboxSessionInfo,
  SandboxSessionStatus,
} from './contracts.js';
import { buildSessionContainerName } from './sessionName.js';
import { waitUntilSessionRunning } from './waitUntilRunning.js';

function mapInspectStatus(raw: string): SandboxSessionStatus {
  const status = raw.trim().toLowerCase();
  if (!status) return 'missing';
  if (status === 'running') return 'running';
  if (status === 'paused') return 'paused';
  if (status === 'created') return 'created';
  if (status === 'exited' || status === 'dead') return 'exited';
  return 'error';
}

export type SessionContainerOptions = {
  cli: ContainerCli;
  policy: SandboxPolicy;
  sessionKey?: string;
};

/**
 * One long-lived container per workspace/session key.
 * create → start once; exec for each ProcessPort call; destroy cleans up.
 */
export class SessionContainer {
  readonly containerName: string;
  private readonly cli: ContainerCli;
  private readonly policy: SandboxPolicy;
  private ensureLock: Promise<void> | undefined;

  constructor(options: SessionContainerOptions) {
    this.cli = options.cli;
    this.policy = options.policy;
    this.containerName = buildSessionContainerName({
      workspaceRoot: options.policy.workspaceRoot,
      sessionKey: options.sessionKey,
    });
  }

  async status(): Promise<SandboxSessionInfo> {
    const result = await this.cli.run(
      [
        'inspect',
        '-f',
        '{{.State.Status}}',
        this.containerName,
      ],
      { timeoutMs: 15_000 },
    );
    if (result.exitCode !== 0) {
      return {
        containerName: this.containerName,
        runtime: this.cli.runtime,
        status: 'missing',
        workspaceRoot: this.policy.workspaceRoot,
      };
    }
    return {
      containerName: this.containerName,
      runtime: this.cli.runtime,
      status: mapInspectStatus(result.stdout),
      workspaceRoot: this.policy.workspaceRoot,
    };
  }

  async ensureRunning(): Promise<void> {
    if (!this.ensureLock) {
      this.ensureLock = this.ensureRunningInner().finally(() => {
        this.ensureLock = undefined;
      });
    }
    await this.ensureLock;
  }

  private async ensureRunningInner(): Promise<void> {
    const info = await this.status();
    if (info.status === 'running') return;
    if (info.status === 'paused') {
      await this.resume();
      return;
    }
    if (info.status === 'created') {
      await this.startExisting();
      return;
    }
    if (info.status === 'exited' || info.status === 'error') {
      await this.destroy();
    }
    await this.createAndStart();
  }

  private async createAndStart(): Promise<void> {
    const workdir = toContainerPath(this.policy.workspaceRoot);
    const create = await this.cli.run(
      [
        'create',
        '--name',
        this.containerName,
        ...buildContainerIsolationArgs(this.policy),
        '-w',
        workdir,
        resolveSandboxImage(process.env, {
          runtime: this.cli.runtime,
          probeLocal: true,
        }),
        ...SESSION_CONTAINER_KEEPALIVE,
      ],
      { timeoutMs: 120_000 },
    );
    if (create.exitCode !== 0) {
      throw new SandboxUnavailableError(
        create.stderr.trim() || 'session container create failed',
        'session_unavailable',
      );
    }
    await this.startExisting();
    await waitUntilSessionRunning(this);
  }

  private async startExisting(): Promise<void> {
    const start = await this.cli.run(['start', this.containerName], {
      timeoutMs: 60_000,
    });
    if (start.exitCode !== 0) {
      throw new SandboxUnavailableError(
        start.stderr.trim() || 'session container start failed',
        'session_unavailable',
      );
    }
  }

  async exec(request: ProcessExecRequest): Promise<ProcessExecResult> {
    await this.ensureRunning();
    await waitUntilSessionRunning(this);
    const scrubbed = scrubSandboxedEnv(request, this.policy);
    const [command, ...args] = scrubbed.argv;
    if (!command) {
      return {
        exitCode: null,
        stdout: '',
        stderr: formatSandboxFailClosed('empty argv'),
        timedOut: false,
        cancelled: false,
        truncated: false,
      };
    }
    const cwd = mapCwdToContainer({
      cwd: scrubbed.cwd,
      workspaceRoot: this.policy.workspaceRoot,
    });
    const envArgs: string[] = [];
    if (scrubbed.env) {
      for (const [key, value] of Object.entries(scrubbed.env)) {
        envArgs.push('-e', `${key}=${value}`);
      }
    }
    return this.cli.run(
      [
        'exec',
        '-i',
        '-w',
        cwd,
        ...envArgs,
        this.containerName,
        command,
        ...args,
      ],
      {
        timeoutMs: scrubbed.timeoutMs,
        maxOutputBytes: scrubbed.maxOutputBytes,
        ...(scrubbed.signal ? { signal: scrubbed.signal } : {}),
      },
    );
  }

  async pause(): Promise<void> {
    const info = await this.status();
    if (info.status === 'missing') {
      throw new SandboxUnavailableError(
        'session container missing',
        'session_not_running',
      );
    }
    if (info.status === 'paused') return;
    const result = await this.cli.run(['pause', this.containerName], {
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new SandboxUnavailableError(
        result.stderr.trim() || 'session pause failed',
        'session_unavailable',
      );
    }
  }

  async resume(): Promise<void> {
    const info = await this.status();
    if (info.status === 'missing') {
      throw new SandboxUnavailableError(
        'session container missing',
        'session_not_running',
      );
    }
    if (info.status === 'running') return;
    const result = await this.cli.run(['unpause', this.containerName], {
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      // Created/exited containers use start, not unpause.
      if (info.status === 'paused') {
        throw new SandboxUnavailableError(
          result.stderr.trim() || 'session resume failed',
          'session_unavailable',
        );
      }
      await this.startExisting();
    }
  }

  async destroy(): Promise<void> {
    const result = await this.cli.run(
      ['rm', '-f', this.containerName],
      { timeoutMs: 60_000 },
    );
    // Missing container is fine (idempotent destroy).
    if (result.exitCode !== 0 && !/no such container/i.test(result.stderr)) {
      throw new SandboxUnavailableError(
        result.stderr.trim() || 'session destroy failed',
        'session_destroy_failed',
      );
    }
  }
}
