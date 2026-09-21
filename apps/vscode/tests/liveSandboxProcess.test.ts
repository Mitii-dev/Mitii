import { describe, expect, it, vi } from 'vitest';
import { createLiveSandboxedProcessPort } from '../src/liveSandboxProcess';
import type { SandboxBackend } from '@mitii/host';

function harness() {
  const settings = new Map<string, unknown>([['safety.approvalMode', 'guided']]);
  const vs = {
    workspace: {
      getConfiguration: () => ({
        get: (key: string) => settings.get(key),
        inspect: (key: string) =>
          settings.has(key) ? { workspaceValue: settings.get(key) } : {},
      }),
    },
  };
  const wrap = vi.fn((request) => request);
  const backend: SandboxBackend = { id: 'seatbelt', available: true, wrap };
  const inner = {
    execFile: vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: false,
      truncated: false,
    })),
  };
  const port = createLiveSandboxedProcessPort(
    vs as never,
    inner,
    '/workspace',
    backend,
  );
  return { settings, wrap, port };
}

const request = {
  argv: ['git', 'status'],
  cwd: '/workspace',
  timeoutMs: 1000,
  maxOutputBytes: 1024,
};

describe('live command access settings', () => {
  it('applies full access and later restricted access on the same process port', async () => {
    const { settings, wrap, port } = harness();
    for (const [mode, network] of [
      ['guided', 'deny'],
      ['pilot', 'allow'],
      ['safe', 'deny'],
    ] as const) {
      settings.set('safety.approvalMode', mode);
      await port.execFile(request);
      expect(wrap).toHaveBeenLastCalledWith(
        request,
        expect.objectContaining({ enabled: true, network }),
      );
    }
  });

  it('preserves an explicit network override when access changes', async () => {
    const { settings, wrap, port } = harness();
    settings.set('safety.sandbox.network', 'deny');
    settings.set('safety.approvalMode', 'pilot');
    await port.execFile(request);
    expect(wrap).toHaveBeenLastCalledWith(
      request,
      expect.objectContaining({ network: 'deny' }),
    );
  });

  it('reuses the sandboxed wrapper when policy is unchanged', async () => {
    const { wrap, port } = harness();
    await port.execFile(request);
    await port.execFile(request);
    expect(wrap).toHaveBeenCalledTimes(2);
    expect(wrap.mock.calls[0]?.[1]).toBe(wrap.mock.calls[1]?.[1]);
  });

  it('ignores a live sandbox disable after sandbox has already been enabled', async () => {
    const { settings, wrap, port } = harness();
    settings.set('safety.approvalMode', 'guided');
    await port.execFile(request);
    expect(wrap).toHaveBeenLastCalledWith(
      request,
      expect.objectContaining({ enabled: true }),
    );

    settings.set('safety.sandbox.enabled', false);
    await port.execFile(request);
    expect(wrap).toHaveBeenLastCalledWith(
      request,
      expect.objectContaining({ enabled: true }),
    );
  });
});
