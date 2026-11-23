import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runInit } from '../src/commands/init.js';
import type { SessionIo } from '../src/session.js';

vi.mock('../src/commands/index.js', () => ({
  runIndex: vi.fn(async () => 0),
  runIndexStatus: vi.fn(async () => 0),
}));

function memoryIo(answers: string[] = []): SessionIo & {
  stdout: string;
  stderr: string;
} {
  const queue = [...answers];
  const state = { stdout: '', stderr: '' };
  return {
    get stdout() {
      return state.stdout;
    },
    get stderr() {
      return state.stderr;
    },
    writeStdout: (chunk: string) => {
      state.stdout += chunk;
    },
    writeStderr: (chunk: string) => {
      state.stderr += chunk;
    },
    prompt: async () => queue.shift() ?? '',
  };
}

describe('mitii init', () => {
  it('bootstraps workspace without indexing when --no-index', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-init-'));
    try {
      const io = memoryIo();
      const { runIndex } = await import('../src/commands/index.js');
      const code = await runInit({
        cwd: dir,
        yes: true,
        noIndex: true,
        agents: true,
        io,
      });
      expect(code).toBe(0);
      expect(existsSync(join(dir, '.mitii'))).toBe(true);
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
      expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toMatch(/\.mitii\//);
      expect(runIndex).not.toHaveBeenCalled();
      expect(io.stdout).toMatch(/Workspace ready/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
