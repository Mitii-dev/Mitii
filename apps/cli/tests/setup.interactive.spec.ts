import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runSetup } from '../src/setup.js';
import type { SessionIo } from '../src/session.js';

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

describe('CLI setup interactive', () => {
  it('prompts for API key, lists models, saves key to .env, and tests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-setup-interactive-'));
    try {
      const io = memoryIo([
        'sk-cloud-test', // API key
        '1', // pick first discovered model
        '', // default mode
        'y', // write config
        'y', // test connection
      ]);
      let listed = false;
      let tested = false;
      const code = await runSetup({
        cwd: dir,
        provider: 'ollama-cloud',
        env: {},
        io,
        listModels: async (input) => {
          listed = true;
          expect(input.apiKey).toBe('sk-cloud-test');
          expect(input.baseUrl).toBe('https://ollama.com/v1');
          return ['qwen3.5:cloud', 'gpt-oss:120b-cloud'];
        },
        testConnection: async (input) => {
          tested = true;
          expect(input.apiKey).toBe('sk-cloud-test');
          expect(input.model).toBe('qwen3.5:cloud');
          return { ok: true, message: 'reachable' };
        },
      });
      expect(code).toBe(0);
      expect(listed).toBe(true);
      expect(tested).toBe(true);

      const config = JSON.parse(
        readFileSync(join(dir, '.mitii', 'config.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(config.providerPreset).toBe('ollama-cloud');
      expect(config.model).toBe('qwen3.5:cloud');
      expect(config.apiKey).toBeUndefined();

      const envText = readFileSync(join(dir, '.mitii', '.env'), 'utf8');
      expect(envText).toMatch(/MITII_API_KEY=sk-cloud-test/);
      expect(io.stdout).toMatch(/Available models:/);
      expect(io.stdout).toMatch(/Connection OK/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps an existing env key and still lists models', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-setup-keep-key-'));
    try {
      const io = memoryIo([
        '', // keep existing key
        '2', // second model
        '', // mode
        'y', // write
        'n', // skip test
      ]);
      const code = await runSetup({
        cwd: dir,
        provider: 'ollama-cloud',
        env: { MITII_API_KEY: 'already-set' },
        io,
        listModels: async () => ['a:cloud', 'b:cloud'],
        testConnection: async () => {
          throw new Error('should not test');
        },
      });
      expect(code).toBe(0);
      const config = JSON.parse(
        readFileSync(join(dir, '.mitii', 'config.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(config.model).toBe('b:cloud');
      expect(io.stdout).toMatch(/using existing MITII_API_KEY/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires a typed model id when listing returns nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-setup-no-models-'));
    try {
      const io = memoryIo([
        'sk-key',
        'my-custom:cloud',
        '',
        'y',
        'n',
      ]);
      const code = await runSetup({
        cwd: dir,
        provider: 'ollama-cloud',
        env: {},
        io,
        listModels: async () => [],
      });
      expect(code).toBe(0);
      const config = JSON.parse(
        readFileSync(join(dir, '.mitii', 'config.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(config.model).toBe('my-custom:cloud');
      expect(io.stdout).toMatch(/No models discovered/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cancels when API key is required and empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-setup-cancel-key-'));
    try {
      const io = memoryIo(['']);
      const code = await runSetup({
        cwd: dir,
        provider: 'ollama-cloud',
        env: {},
        io,
        listModels: async () => [],
      });
      expect(code).toBe(1);
      expect(io.stderr).toMatch(/API key required/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
