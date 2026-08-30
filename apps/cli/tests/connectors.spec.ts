import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/cli.js';
import {
  parseBooleanFlag,
  parseStringFlag,
  sanitizeKey,
  writeJsonFile,
  readJsonFile,
} from '../src/connectors/common.js';
import { listConnectors, getConnector } from '../src/connectors/registry.js';
import {
  loadThreadCarry,
  saveThreadCarry,
  clearThreadCarry,
} from '../src/connectors/thread-state.js';

describe('connect CLI parsing', () => {
  it('parses connect with channel passthrough flags', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      '--cwd',
      '/tmp/ws',
      'connect',
      'telegram',
      '--token',
      '123:abc',
      '--allowed-user-id',
      '99',
    ]);
    expect(parsed.command).toBe('connect');
    expect(parsed.cwd).toBe('/tmp/ws');
    expect(parsed.rest).toEqual([
      'telegram',
      '--token',
      '123:abc',
      '--allowed-user-id',
      '99',
    ]);
  });

  it('parses connect --stop without treating --stop as unknown', () => {
    const parsed = parseCliArgs(['node', 'mitii', 'connect', '--stop']);
    expect(parsed.command).toBe('connect');
    expect(parsed.rest).toEqual(['--stop']);
  });
});

describe('connector registry', () => {
  it('lists telegram, discord, and slack', () => {
    const names = listConnectors().map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['telegram', 'discord', 'slack']));
  });

  it('loads telegram connector', async () => {
    const connector = await getConnector('telegram');
    expect(connector?.name).toBe('telegram');
  });

  it('loads discord and slack connectors', async () => {
    expect((await getConnector('discord'))?.name).toBe('discord');
    expect((await getConnector('slack'))?.name).toBe('slack');
  });
});

describe('connector common helpers', () => {
  it('parses flags', () => {
    const args = ['--token', 'abc', '--echo', '-u', 'bot'];
    expect(parseStringFlag(args, '-t', '--token')).toBe('abc');
    expect(parseStringFlag(args, '-u', '--bot-username')).toBe('bot');
    expect(parseBooleanFlag(args, '--echo')).toBe(true);
    expect(sanitizeKey('a b/c')).toBe('a_b_c');
  });
});

describe('thread carry store', () => {
  it('persists and clears per-thread conversation', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mitii-connect-'));
    try {
      saveThreadCarry(
        'telegram',
        'mybot',
        'chat-1',
        {
          conversation: [{ role: 'user', content: 'hi' }],
          updatedAt: new Date().toISOString(),
        },
        cwd,
      );
      const loaded = loadThreadCarry('telegram', 'mybot', 'chat-1', cwd);
      expect(loaded?.conversation).toEqual([{ role: 'user', content: 'hi' }]);
      clearThreadCarry('telegram', 'mybot', 'chat-1', cwd);
      expect(loadThreadCarry('telegram', 'mybot', 'chat-1', cwd)).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('round-trips json state files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mitii-connect-json-'));
    try {
      const path = join(cwd, 'state.json');
      writeJsonFile(path, { ok: true });
      expect(readJsonFile<{ ok: boolean }>(path)).toEqual({ ok: true });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
