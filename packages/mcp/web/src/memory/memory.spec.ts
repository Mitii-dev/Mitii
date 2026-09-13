import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveSafeFactsPath, isMemoryToolsEnabled } from './pathSafety.js';
import {
  rankShareableFacts,
  softParseFactsEnvelope,
} from './softParseFacts.js';
import { handleMemoryToolCall } from './handleMemoryTool.js';

describe('mcp-web memory soft parse', () => {
  it('skips private and malformed facts', () => {
    const facts = softParseFactsEnvelope(
      JSON.stringify({
        storageVersion: 2,
        facts: [
          {
            id: 'a',
            content: 'prefer pnpm',
            privacy: 'shareable',
            tags: ['tooling'],
          },
          { id: 'b', content: 'secret', privacy: 'private' },
          { id: 'bad' },
        ],
      }),
    );
    expect(facts.map((f) => f.id)).toEqual(['a', 'b']);
    const ranked = rankShareableFacts(facts, 'pnpm', 5);
    expect(ranked.map((f) => f.id)).toEqual(['a']);
  });

  it('returns empty on corrupt JSON', () => {
    expect(softParseFactsEnvelope('{not-json')).toEqual([]);
  });
});

describe('pathSafety', () => {
  it('blocks path traversal outside workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-mcp-mem-'));
    await mkdir(join(root, '.mitii', 'memory'), { recursive: true });
    await writeFile(
      join(root, '.mitii', 'memory', 'facts.json'),
      '{"storageVersion":2,"facts":[]}\n',
      'utf8',
    );

    const escaped = await resolveSafeFactsPath({
      workspaceRoot: root,
      relativeOrAbsolute: '../facts.json',
    });
    expect(escaped.ok).toBe(false);

    const ok = await resolveSafeFactsPath({ workspaceRoot: root });
    expect(ok.ok).toBe(true);
  });

  it('isMemoryToolsEnabled is opt-in', () => {
    expect(isMemoryToolsEnabled({})).toBe(false);
    expect(isMemoryToolsEnabled({ MITII_MCP_WEB_MEMORY: '1' })).toBe(true);
  });
});

describe('handleMemoryToolCall', () => {
  it('errors when disabled', async () => {
    const result = await handleMemoryToolCall(
      'memory_search',
      { query: 'x' },
      {},
    );
    expect(result?.isError).toBe(true);
  });

  it('returns shareable hits only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-mcp-mem-'));
    await mkdir(join(root, '.mitii', 'memory'), { recursive: true });
    await writeFile(
      join(root, '.mitii', 'memory', 'facts.json'),
      JSON.stringify({
        storageVersion: 2,
        facts: [
          {
            id: 's1',
            content: 'use vitest for unit tests',
            privacy: 'shareable',
            tags: ['test'],
          },
          {
            id: 'p1',
            content: 'api key pattern',
            privacy: 'private',
            tags: ['secret'],
          },
        ],
      }),
      'utf8',
    );

    const result = await handleMemoryToolCall(
      'memory_search',
      { query: 'vitest' },
      {
        MITII_MCP_WEB_MEMORY: '1',
        MITII_WORKSPACE_ROOT: root,
      },
    );
    expect(result?.isError).toBeFalsy();
    const text = result?.content[0]?.text ?? '';
    expect(text).toContain('s1');
    expect(text).not.toContain('p1');
  });
});
