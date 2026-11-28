import { describe, expect, it, vi } from 'vitest';

import { resolveSandboxPolicy } from '../contracts/policy.js';
import type { ContainerCli } from './ContainerCli.js';
import { SessionContainer } from './SessionContainer.js';

function mockCli(): ContainerCli & {
  calls: string[][];
  responses: Map<string, { exitCode: number; stdout: string; stderr: string }>;
} {
  const calls: string[][] = [];
  const responses = new Map<
    string,
    { exitCode: number; stdout: string; stderr: string }
  >();
  const cli: ContainerCli & {
    calls: string[][];
    responses: typeof responses;
  } = {
    runtime: 'docker',
    calls,
    responses,
    async run(argvTail) {
      const key = argvTail[0] ?? '';
      calls.push([...argvTail]);
      const canned = responses.get(key) ?? {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
      return {
        ...canned,
        timedOut: false,
        cancelled: false,
        truncated: false,
      };
    },
  };
  return cli;
}

describe('SessionContainer', () => {
  it('creates and starts when missing, then execs', async () => {
    const cli = mockCli();
    cli.responses.set('inspect', {
      exitCode: 1,
      stdout: '',
      stderr: 'No such container',
    });
    cli.responses.set('create', { exitCode: 0, stdout: 'id', stderr: '' });
    cli.responses.set('start', { exitCode: 0, stdout: '', stderr: '' });
    cli.responses.set('exec', {
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    });

    const session = new SessionContainer({
      cli,
      policy: resolveSandboxPolicy({
        enabled: true,
        network: 'deny',
        workspaceRoot: '/tmp/ws',
      }),
      sessionKey: 'run-1',
    });

    // First status in ensure → missing; after create/start, exec runs.
    let inspectCount = 0;
    cli.run = async (argvTail) => {
      cli.calls.push([...argvTail]);
      const head = argvTail[0] ?? '';
      if (head === 'inspect') {
        inspectCount += 1;
        if (inspectCount === 1) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'missing',
            timedOut: false,
            cancelled: false,
            truncated: false,
          };
        }
        return {
          exitCode: 0,
          stdout: 'running',
          stderr: '',
          timedOut: false,
          cancelled: false,
          truncated: false,
        };
      }
      return {
        exitCode: 0,
        stdout: head === 'exec' ? 'ok' : '',
        stderr: '',
        timedOut: false,
        cancelled: false,
        truncated: false,
      };
    };

    const result = await session.exec({
      argv: ['echo', 'hi'],
      cwd: '/tmp/ws',
      env: { PATH: '/usr/bin', LD_PRELOAD: '/evil.so' },
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.stdout).toBe('ok');
    expect(cli.calls.some((c) => c[0] === 'create')).toBe(true);
    expect(cli.calls.some((c) => c[0] === 'start')).toBe(true);
    const execCall = cli.calls.find((c) => c[0] === 'exec');
    expect(execCall).toBeDefined();
    expect(execCall?.join(' ')).toContain('echo');
    expect(execCall?.join(' ')).not.toContain('LD_PRELOAD');
    expect(execCall?.join(' ')).toContain('PATH=/usr/bin');
  });

  it('destroys idempotently when container is already gone', async () => {
    const cli = mockCli();
    cli.responses.set('rm', {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: No such container: mitii-sandbox-x',
    });
    const session = new SessionContainer({
      cli,
      policy: resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
      }),
    });
    await expect(session.destroy()).resolves.toBeUndefined();
  });

  it('pause fails closed when container is missing', async () => {
    const cli = mockCli();
    cli.responses.set('inspect', {
      exitCode: 1,
      stdout: '',
      stderr: 'missing',
    });
    const session = new SessionContainer({
      cli,
      policy: resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
      }),
    });
    await expect(session.pause()).rejects.toMatchObject({
      code: 'session_not_running',
    });
  });
});

describe('createSessionSandboxedProcessPort', () => {
  it('fail-closes when session runtime is unavailable', async () => {
    const { createSessionSandboxedProcessPort } = await import(
      './createSessionSandboxedProcessPort.js'
    );
    const inner = {
      execFile: vi.fn(async () => ({
        exitCode: 0,
        stdout: 'should-not-run',
        stderr: '',
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    };
    const port = createSessionSandboxedProcessPort({
      inner,
      policy: resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
      }),
      prefer: 'seatbelt',
    });
    const result = await port.execFile({
      argv: ['echo', 'hi'],
      cwd: '/tmp/ws',
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('fail-closed');
    expect(result.stderr).toMatch(/docker|podman/i);
    expect(inner.execFile).not.toHaveBeenCalled();
  });
});
