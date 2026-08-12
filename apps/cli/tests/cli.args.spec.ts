import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/cli.js';
import { resolveCliPorts } from '../src/ports.js';

describe('CLI parseCliArgs', () => {
  it('treats --help as help', () => {
    expect(parseCliArgs(['node', 'mitii', '--help']).command).toBe('help');
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

  it('rejects unknown commands', () => {
    const parsed = parseCliArgs(['node', 'mitii', 'board']);
    expect(parsed.command).toBe('unknown');
    expect(parsed.unknownCommand).toBe('board');
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
});
