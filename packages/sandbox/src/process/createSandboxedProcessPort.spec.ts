import { describe, expect, it } from 'vitest';

import type { ProcessExecRequest, ProcessPort } from '@mitii/v8';

import { resolveBubblewrapBackend } from '../adapters/bubblewrap/index.js';
import { resolveDockerBackend } from '../adapters/docker/index.js';
import { buildSeatbeltProfile } from '../adapters/seatbelt/index.js';
import {
  createSandboxedProcessPort,
} from './createSandboxedProcessPort.js';
import { resolveSandboxPolicy } from '../contracts/policy.js';
import { detectSandboxBackend } from './detect.js';
import { scrubSandboxedEnv } from '../helpers/envScrub.js';

class RecordingProcessPort implements ProcessPort {
  public last?: ProcessExecRequest;
  execFile(request: ProcessExecRequest) {
    this.last = request;
    return Promise.resolve({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
      cancelled: false,
      truncated: false,
    });
  }
}

describe('createSandboxedProcessPort', () => {
  it('passes through when disabled', async () => {
    const inner = new RecordingProcessPort();
    const port = createSandboxedProcessPort(
      inner,
      resolveSandboxPolicy({
        enabled: false,
        workspaceRoot: '/tmp/ws',
      }),
    );
    await port.execFile({
      argv: ['echo', 'hi'],
      cwd: '/tmp/ws',
      env: {},
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });
    expect(inner.last?.argv).toEqual(['echo', 'hi']);
    expect(port.sandboxEnabled).toBe(false);
  });

  it('fails closed when enabled but backend unavailable', async () => {
    const inner = new RecordingProcessPort();
    const port = createSandboxedProcessPort(
      inner,
      resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
      }),
      {
        id: 'unavailable',
        available: false,
        reason: 'test backend missing',
        wrap: () => {
          throw new Error('should not wrap');
        },
      },
    );
    const result = await port.execFile({
      argv: ['echo', 'hi'],
      cwd: '/tmp/ws',
      env: {},
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('fail-closed');
    expect(inner.last).toBeUndefined();
    expect(port.sandboxBackendId).toBe('unavailable');
  });

  it('fails closed when docker backend is unavailable', async () => {
    const inner = new RecordingProcessPort();
    const port = createSandboxedProcessPort(
      inner,
      resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
      }),
      {
        id: 'docker',
        available: false,
        reason: 'docker not found on PATH',
        wrap: () => {
          throw new Error('should not wrap');
        },
      },
    );
    const result = await port.execFile({
      argv: ['echo', 'hi'],
      cwd: '/tmp/ws',
      env: {},
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('fail-closed');
    expect(result.stderr).toContain('docker');
    expect(inner.last).toBeUndefined();
  });

  it('detectSandboxBackend reports a concrete id from the union', () => {
    const backend = detectSandboxBackend();
    expect([
      'seatbelt',
      'bubblewrap',
      'docker',
      'podman',
      'unavailable',
    ]).toContain(backend.id);
  });

  it('prefer seatbelt on non-mac fails closed as unavailable', () => {
    const backend = detectSandboxBackend({ prefer: 'seatbelt' });
    if (process.platform !== 'darwin') {
      expect(backend.available).toBe(false);
      expect(backend.id).toBe('unavailable');
    } else {
      expect(backend.id).toBe('seatbelt');
    }
  });

  it('prefer docker uses docker id (fail-closed when missing)', () => {
    const backend = detectSandboxBackend({ prefer: 'docker' });
    expect(backend.id).toBe('docker');
    if (!backend.available) {
      expect(backend.reason).toMatch(/docker/i);
    }
  });

  it('resolveDockerBackend wraps with docker run --rm -i and resource caps', () => {
    const backend = resolveDockerBackend('docker');
    if (!backend.available) {
      expect(backend.id).toBe('docker');
      return;
    }
    const wrapped = backend.wrap(
      {
        argv: ['echo', 'hi'],
        cwd: '/tmp/ws',
        env: {},
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      },
      resolveSandboxPolicy({
        enabled: true,
        network: 'deny',
        workspaceRoot: '/tmp/ws',
      }),
    );
    expect(wrapped.argv[0]).toBe('docker');
    expect(wrapped.argv.slice(1, 4)).toEqual(['run', '--rm', '-i']);
    expect(wrapped.argv).toContain('--memory');
    expect(wrapped.argv).toContain('--cpus');
    expect(wrapped.argv).toContain('--pids-limit');
    expect(wrapped.argv).toContain('--network');
    expect(wrapped.argv).toContain('none');
    expect(wrapped.argv).toContain('-v');
    expect(wrapped.argv).toContain('/tmp/ws:/tmp/ws');
    expect(wrapped.argv).toContain('-w');
  });
});

describe('seatbelt profile', () => {
  it('strict profile scopes file reads', () => {
    const profile = buildSeatbeltProfile(
      resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
        isolationProfile: 'strict',
      }),
    );
    expect(profile).toContain('(deny default)');
    expect(profile).toContain('/tmp/ws');
    expect(profile).not.toMatch(/^\(allow file-read\*\)$/m);
    expect(profile).toContain('(allow file-read* (subpath "/usr/lib"))');
  });

  it('balanced profile allows broad reads for tool success', () => {
    const profile = buildSeatbeltProfile(
      resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
        isolationProfile: 'balanced',
      }),
    );
    expect(profile).toContain('(allow file-read*)');
    expect(profile).toContain('(deny network*)');
  });
});

describe('env scrub', () => {
  it('strips loader-hijack and secret-like keys in balanced profile', () => {
    const scrubbed = scrubSandboxedEnv(
      {
        argv: ['echo'],
        cwd: '/tmp/ws',
        env: {
          PATH: '/usr/bin',
          LD_PRELOAD: '/evil.so',
          DYLD_INSERT_LIBRARIES: '/evil.dylib',
          OPENAI_API_KEY: 'sk-test',
          AWS_SECRET_ACCESS_KEY: 'x',
          KEEP: 'yes',
        },
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      },
      resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: '/tmp/ws',
        isolationProfile: 'balanced',
      }),
    );
    expect(scrubbed.env?.PATH).toBe('/usr/bin');
    expect(scrubbed.env?.KEEP).toBe('yes');
    expect(scrubbed.env?.LD_PRELOAD).toBeUndefined();
    expect(scrubbed.env?.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(scrubbed.env?.OPENAI_API_KEY).toBeUndefined();
    expect(scrubbed.env?.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
});

describe('bubblewrap deny-read overlays', () => {
  it('includes tmpfs or null bind args for denyReadPaths when available', () => {
    const backend = resolveBubblewrapBackend();
    if (!backend.available) {
      expect(backend.id).toBe('bubblewrap');
      return;
    }
    const wrapped = backend.wrap(
      {
        argv: ['echo', 'hi'],
        cwd: '/tmp',
        env: {},
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      },
      resolveSandboxPolicy({
        enabled: true,
        network: 'deny',
        workspaceRoot: '/tmp',
        denyReadPaths: ['/tmp'],
      }),
    );
    expect(wrapped.argv[0]).toBe('bwrap');
    expect(wrapped.argv).toContain('--unshare-net');
    // /tmp is a directory → tmpfs overlay after workspace bind
    expect(wrapped.argv).toContain('--tmpfs');
  });
});
