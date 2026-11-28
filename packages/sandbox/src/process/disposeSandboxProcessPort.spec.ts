import { describe, expect, it, vi } from 'vitest';

import { resolveSandboxPolicy } from '../contracts/policy.js';
import { createSandboxedProcessPort } from './createSandboxedProcessPort.js';
import { describeSandboxPort } from './describeSandboxPort.js';
import { disposeSandboxProcessPort } from './disposeSandboxProcessPort.js';
import { isSessionSandboxedProcessPort } from './isSessionSandboxedProcessPort.js';
import { createSessionSandboxedProcessPort } from '../lifecycle/createSessionSandboxedProcessPort.js';
import { probeSandboxReadiness } from './probeSandboxReadiness.js';

describe('disposeSandboxProcessPort', () => {
  it('no-ops for ephemeral sandboxed ports', async () => {
    const port = createSandboxedProcessPort(
      {
        execFile: async () => ({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          cancelled: false,
          truncated: false,
        }),
      },
      resolveSandboxPolicy({ enabled: true, workspaceRoot: '/tmp/ws' }),
      { id: 'seatbelt', available: true, wrap: (r) => r },
    );
    await expect(disposeSandboxProcessPort(port)).resolves.toBeUndefined();
    expect(isSessionSandboxedProcessPort(port)).toBe(false);
  });

  it('destroys session ports', async () => {
    const destroy = vi.fn(async () => undefined);
    const port = createSessionSandboxedProcessPort({
      inner: {
        execFile: async () => ({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          cancelled: false,
          truncated: false,
        }),
      },
      policy: resolveSandboxPolicy({ enabled: true, workspaceRoot: '/tmp/ws' }),
      prefer: 'seatbelt',
    });
    // Force a session-shaped port with a spy destroy for the type guard path.
    const sessionShaped = {
      ...port,
      lifecycle: 'session' as const,
      destroy,
      status: async () => ({
        containerName: 'x',
        runtime: 'docker' as const,
        status: 'missing' as const,
        workspaceRoot: '/tmp/ws',
      }),
      pause: async () => undefined,
      resume: async () => undefined,
      containerName: 'x',
      execFile: port.execFile.bind(port),
      sandboxBackendId: port.sandboxBackendId,
      sandboxEnabled: port.sandboxEnabled,
    };
    expect(isSessionSandboxedProcessPort(sessionShaped)).toBe(true);
    await disposeSandboxProcessPort(sessionShaped);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('describeSandboxPort', () => {
  it('describes ephemeral ports without secrets', () => {
    const port = createSandboxedProcessPort(
      {
        execFile: async () => ({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          cancelled: false,
          truncated: false,
        }),
      },
      resolveSandboxPolicy({ enabled: true, workspaceRoot: '/tmp/ws' }),
      { id: 'docker', available: true, wrap: (r) => r },
    );
    expect(describeSandboxPort(port)).toEqual({
      sandboxEnabled: true,
      sandboxBackendId: 'docker',
      lifecycle: 'ephemeral',
    });
  });
});

describe('probeSandboxReadiness', () => {
  it('reports sessionSupported independently of ephemeral backend', () => {
    const readiness = probeSandboxReadiness({
      enabled: true,
      prefer: 'auto',
      lifecycle: 'ephemeral',
    });
    expect(readiness.enabled).toBe(true);
    expect(readiness.lifecycle).toBe('ephemeral');
    expect(typeof readiness.sessionSupported).toBe('boolean');
    expect([
      'seatbelt',
      'bubblewrap',
      'docker',
      'podman',
      'unavailable',
    ]).toContain(readiness.backendId);
  });

  it('uses session runtime when lifecycle is session', () => {
    const readiness = probeSandboxReadiness({
      enabled: true,
      prefer: 'seatbelt',
      lifecycle: 'session',
    });
    expect(readiness.available).toBe(false);
    expect(readiness.backendId).toBe('unavailable');
    expect(readiness.reason).toMatch(/docker|podman/i);
  });
});
