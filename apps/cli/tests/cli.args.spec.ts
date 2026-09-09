import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatSessionHeader, MITII_BANNER } from '../src/banner.js';
import { parseCliArgs } from '../src/cli.js';
import { saveMitiiHostConfig } from '../src/config.js';
import { resolveCliPorts } from '../src/ports.js';
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

describe('CLI parseCliArgs', () => {
  it('treats --help and -h as help', () => {
    expect(parseCliArgs(['node', 'mitii', '--help']).command).toBe('help');
    expect(parseCliArgs(['node', 'mitii', '-h']).command).toBe('help');
  });

  it('treats --version and -v as version', () => {
    expect(parseCliArgs(['node', 'mitii', '--version']).command).toBe(
      'version',
    );
    expect(parseCliArgs(['node', 'mitii', '-v']).command).toBe('version');
    expect(parseCliArgs(['node', 'mitii', 'version']).command).toBe('version');
  });

  it('rejects unknown options instead of ignoring them', () => {
    const parsed = parseCliArgs(['node', 'mitii', 'ask', 'hi', '--nope']);
    expect(parsed.command).toBe('error');
    expect(parsed.errorMessage).toMatch(/unknown option "--nope"/);
  });

  it('parses ask with cwd and json', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'ask',
      'What',
      'is',
      'recursion?',
      '--cwd',
      '/tmp/ws',
      '--json',
      '--echo',
    ]);
    expect(parsed.command).toBe('ask');
    expect(parsed.prompt).toBe('What is recursion?');
    expect(parsed.cwd).toBe('/tmp/ws');
    expect(parsed.json).toBe(true);
    expect(parsed.forceEcho).toBe(true);
  });

  it('parses setup flags', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'setup',
      '--provider',
      'ollama',
      '--model',
      'qwen3-coder:30b',
      '--yes',
      '--test',
      '--global',
    ]);
    expect(parsed.command).toBe('setup');
    expect(parsed.setupProvider).toBe('ollama');
    expect(parsed.setupModel).toBe('qwen3-coder:30b');
    expect(parsed.setupYes).toBe(true);
    expect(parsed.setupTest).toBe(true);
    expect(parsed.setupGlobal).toBe(true);
  });

  it('rejects unknown commands', () => {
    const parsed = parseCliArgs(['node', 'mitii', 'board']);
    expect(parsed.command).toBe('unknown');
    expect(parsed.unknownCommand).toBe('board');
  });
});

describe('CLI banner', () => {
  it('includes dotted MITII art and setup hint for echo', () => {
    expect(MITII_BANNER).toMatch(/·/);
    const header = formatSessionHeader({
      cwd: '/tmp/ws',
      providerLabel: 'echo',
      mode: 'ask',
      version: '0.0.0',
      isEcho: true,
      showSetupHint: true,
    });
    expect(header).toContain('Mitii CLI');
    expect(header).toContain('mitii setup');
    expect(header).toContain('/tmp/ws');
  });
});

describe('CLI setup', () => {
  it('writes non-secret config with --yes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-setup-'));
    try {
      const io = memoryIo();
      const code = await runSetup({
        cwd: dir,
        provider: 'ollama',
        yes: true,
        io,
      });
      expect(code).toBe(0);
      const raw = JSON.parse(
        readFileSync(join(dir, '.mitii', 'config.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(raw.provider).toBe('openai-compatible');
      expect(raw.providerPreset).toBe('ollama');
      expect(raw.model).toBeTruthy();
      expect(raw.apiKey).toBeUndefined();
      expect(io.stdout).toMatch(/Wrote /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints --show without writing secrets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-setup-show-'));
    try {
      saveMitiiHostConfig(
        {
          provider: 'anthropic',
          providerPreset: 'anthropic',
          model: 'claude-sonnet-4-5',
          defaultMode: 'ask',
        },
        { cwd: dir },
      );
      const io = memoryIo();
      const code = await runSetup({ cwd: dir, show: true, io });
      expect(code).toBe(0);
      expect(io.stdout).toMatch(/anthropic/);
      expect(io.stdout).toMatch(/claude-sonnet-4-5/);
      expect(io.stdout).not.toMatch(/sk-/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI resolveCliPorts', () => {
  it('defaults to echo without API keys', () => {
    const ports = resolveCliPorts({ env: {} });
    expect(ports.providerLabel).toBe('echo');
  });

  it('forces echo even when a key is present', () => {
    const ports = resolveCliPorts({
      forceEcho: true,
      env: { OPENAI_API_KEY: 'sk-test' },
    });
    expect(ports.providerLabel).toBe('echo');
  });

  it('selects anthropic when ANTHROPIC_API_KEY is set', () => {
    const ports = resolveCliPorts({
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    });
    expect(ports.providerLabel).toBe('anthropic:claude-sonnet-4-5');
  });

  it('selects gemini from explicit MITII_PROVIDER', () => {
    const ports = resolveCliPorts({
      env: {
        MITII_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'g-test',
        MITII_MODEL: 'gemini-2.5-pro',
      },
    });
    expect(ports.providerLabel).toBe('gemini:gemini-2.5-pro');
  });

  it('parses repeatable --skill flags for ask', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'ask',
      'write docs',
      '--skill',
      'module-doc-generator',
      '--skill',
      'planning-default',
    ]);
    expect(parsed.command).toBe('ask');
    expect(parsed.skills).toEqual([
      'module-doc-generator',
      'planning-default',
    ]);
  });

  it('parses repeatable --image flags for ask', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'ask',
      'describe these',
      '--image',
      './mock.png',
      '--image',
      './second.jpg',
    ]);
    expect(parsed.command).toBe('ask');
    expect(parsed.images).toEqual(['./mock.png', './second.jpg']);
  });

  it('leaves images undefined when --image is not passed', () => {
    const parsed = parseCliArgs(['node', 'mitii', 'ask', 'plain prompt']);
    expect(parsed.command).toBe('ask');
    expect(parsed.images).toBeUndefined();
  });
});
