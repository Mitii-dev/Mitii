import { describe, expect, it } from 'vitest';

import { resolveSandboxPolicy } from '../contracts/policy.js';
import type { ContainerCli } from './ContainerCli.js';
import { SessionSandboxPool } from './SessionSandboxPool.js';

function mockCli(): ContainerCli {
  let running = false;
  return {
    runtime: 'docker',
    async run(argvTail) {
      const head = argvTail[0] ?? '';
      if (head === 'inspect') {
        return {
          exitCode: running ? 0 : 1,
          stdout: running ? 'running' : '',
          stderr: running ? '' : 'missing',
          timedOut: false,
          cancelled: false,
          truncated: false,
        };
      }
      if (head === 'create' || head === 'start') {
        running = true;
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          cancelled: false,
          truncated: false,
        };
      }
      if (head === 'rm') {
        running = false;
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          cancelled: false,
          truncated: false,
        };
      }
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        cancelled: false,
        truncated: false,
      };
    },
  };
}

describe('SessionSandboxPool', () => {
  it('reuses idle sessions on acquire/release', async () => {
    const pool = new SessionSandboxPool({
      cli: mockCli(),
      policy: resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
      }),
      maxIdle: 2,
    });
    const a = await pool.acquire();
    await pool.release(a);
    expect(pool.idleCount).toBe(1);
    const b = await pool.acquire();
    expect(b.containerName).toBe(a.containerName);
    expect(pool.idleCount).toBe(0);
    await pool.destroy();
  });
});
