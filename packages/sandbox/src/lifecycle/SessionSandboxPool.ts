import { DEFAULT_SESSION_POOL } from '../constants.js';
import type { SandboxPolicy } from '../contracts/policy.js';
import { SandboxUnavailableError } from '../contracts/errors.js';
import type { ContainerCli } from './ContainerCli.js';
import { SessionContainer } from './SessionContainer.js';

export type SessionSandboxPoolOptions = {
  cli: ContainerCli;
  policy: SandboxPolicy;
  maxIdle?: number;
  /** Prefix for pooled session keys. */
  poolName?: string;
};

/**
 * In-process warm pool of session containers for the same workspace policy.
 * acquire() returns a running SessionContainer; release() returns it to idle
 * (or destroys when over capacity). Raises create latency on hot path.
 */
export class SessionSandboxPool {
  private readonly cli: ContainerCli;
  private readonly policy: SandboxPolicy;
  private readonly maxIdle: number;
  private readonly poolName: string;
  private readonly idle: SessionContainer[] = [];
  private seq = 0;
  private destroyed = false;

  constructor(options: SessionSandboxPoolOptions) {
    this.cli = options.cli;
    this.policy = options.policy;
    this.maxIdle = options.maxIdle ?? DEFAULT_SESSION_POOL.maxIdle;
    this.poolName = options.poolName ?? 'pool';
  }

  get idleCount(): number {
    return this.idle.length;
  }

  async warmup(count = 1): Promise<void> {
    this.assertOpen();
    const n = Math.max(0, Math.min(count, this.maxIdle - this.idle.length));
    for (let i = 0; i < n; i += 1) {
      const session = this.createMember();
      await session.ensureRunning();
      this.idle.push(session);
    }
  }

  async acquire(): Promise<SessionContainer> {
    this.assertOpen();
    const existing = this.idle.pop();
    if (existing) {
      await existing.ensureRunning();
      return existing;
    }
    const session = this.createMember();
    await session.ensureRunning();
    return session;
  }

  async release(session: SessionContainer): Promise<void> {
    if (this.destroyed) {
      await session.destroy().catch(() => undefined);
      return;
    }
    if (this.idle.length >= this.maxIdle) {
      await session.destroy().catch(() => undefined);
      return;
    }
    this.idle.push(session);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    const members = this.idle.splice(0, this.idle.length);
    await Promise.all(
      members.map((session) => session.destroy().catch(() => undefined)),
    );
  }

  private createMember(): SessionContainer {
    this.seq += 1;
    return new SessionContainer({
      cli: this.cli,
      policy: this.policy,
      sessionKey: `${this.poolName}-${this.seq}`,
    });
  }

  private assertOpen(): void {
    if (this.destroyed) {
      throw new SandboxUnavailableError(
        'session sandbox pool destroyed',
        'session_unavailable',
      );
    }
  }
}
