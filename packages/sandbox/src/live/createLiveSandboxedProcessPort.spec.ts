import { describe, expect, it, vi } from 'vitest';

import type { SandboxBackend } from '../contracts/policy.js';
import { createLiveSandboxedProcessPort } from './createLiveSandboxedProcessPort.js';

function harness() {
  const state = {
    approvalMode: 'guided' as string,
    enabled: undefined as boolean | undefined,
    network: undefined as string | undefined,
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
    () => ({
      approvalMode: state.approvalMode,
      ...(state.enabled !== undefined ? { enabled: state.enabled } : {}),
      ...(state.network !== undefined ? { network: state.network } : {}),
    }),
    inner,
    '/workspace',
    backend,
  );
  return { state, wrap, port };
}

const request = {
  argv: ['git', 'status'],
  cwd: '/workspace',
  timeoutMs: 1000,
  maxOutputBytes: 1024,
};

describe('createLiveSandboxedProcessPort', () => {
  it('applies full access and later restricted access on the same process port', async () => {
    const { state, wrap, port } = harness();
    for (const [mode, network] of [
      ['guided', 'deny'],
      ['pilot', 'allow'],
      ['safe', 'deny'],
    ] as const) {
      state.approvalMode = mode;
      await port.execFile(request);
      expect(wrap).toHaveBeenLastCalledWith(
        request,
        expect.objectContaining({ enabled: true, network }),
      );
    }
  });

  it('preserves an explicit network override when access changes', async () => {
    const { state, wrap, port } = harness();
    state.network = 'deny';
    state.approvalMode = 'pilot';
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
    const { state, wrap, port } = harness();
    state.approvalMode = 'guided';
    await port.execFile(request);
    expect(wrap).toHaveBeenLastCalledWith(
      request,
      expect.objectContaining({ enabled: true }),
    );

    state.enabled = false;
    await port.execFile(request);
    expect(wrap).toHaveBeenLastCalledWith(
      request,
      expect.objectContaining({ enabled: true }),
    );
  });
});
