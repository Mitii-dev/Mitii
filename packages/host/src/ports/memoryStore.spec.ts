import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createWorkspaceMemoryStore } from './memoryStore.js';

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'mitii-memory-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('FileWorkspaceMemoryStore enterprise persistence', () => {
  it('serializes concurrent commits without last-write-wins loss', async () => {
    await withTempRoot(async (root) => {
      const store = createWorkspaceMemoryStore(root, 'ws-1');
      const base = {
        scope: { kind: 'workspace' as const, workspaceId: 'ws-1' },
        privacy: 'shareable' as const,
        createdAt: new Date().toISOString(),
        source: 'test',
        type: 'fact' as const,
      };

      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          store.commit({
            ...base,
            id: `fact-${i}`,
            content: `content-${i}`,
          }),
        ),
      );

      const listed = await store.list({
        kind: 'workspace',
        workspaceId: 'ws-1',
      });
      expect(listed).toHaveLength(20);
      expect(new Set(listed.map((f) => f.id)).size).toBe(20);
    });
  });

  it('reports honest delete results for missing ids', async () => {
    await withTempRoot(async (root) => {
      const store = createWorkspaceMemoryStore(root, 'ws-1');
      await store.commit({
        id: 'keep-me',
        content: 'hello',
        scope: { kind: 'workspace', workspaceId: 'ws-1' },
        privacy: 'shareable',
        createdAt: new Date().toISOString(),
        source: 'test',
      });

      const missing = await store.delete('does-not-exist');
      expect(missing).toEqual({
        id: 'does-not-exist',
        deleted: false,
        message: 'Memory id "does-not-exist" not found.',
      });

      const removed = await store.delete('keep-me');
      expect(removed.deleted).toBe(true);
      expect(await store.list()).toHaveLength(0);
    });
  });

  it('soft-fails corrupt facts without wiping valid entries on read', async () => {
    await withTempRoot(async (root) => {
      const factsPath = join(root, '.mitii', 'memory', 'facts.json');
      const store = createWorkspaceMemoryStore(root, 'ws-1');
      await store.commit({
        id: 'good',
        content: 'valid fact',
        scope: { kind: 'workspace', workspaceId: 'ws-1' },
        privacy: 'shareable',
        createdAt: new Date().toISOString(),
        source: 'test',
      });

      const envelope = JSON.parse(await readFile(factsPath, 'utf8')) as {
        storageVersion: number;
        facts: unknown[];
      };
      envelope.facts.push({ id: 'bad', content: 123 });
      await writeFile(factsPath, `${JSON.stringify(envelope)}\n`, 'utf8');

      const listed = await store.list();
      expect(listed.map((f) => f.id)).toEqual(['good']);
    });
  });

  it('serializes interleaved commit and recordAccess safely', async () => {
    await withTempRoot(async (root) => {
      const store = createWorkspaceMemoryStore(root, 'ws-1');
      const commits: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i += 1) {
        commits.push(
          store.commit({
            id: `a-${i}`,
            content: `a-${i}`,
            scope: { kind: 'workspace', workspaceId: 'ws-1' },
            privacy: 'shareable',
            createdAt: new Date().toISOString(),
            source: 'test',
          }),
        );
        commits.push(store.recordAccess([`a-${i}`], new Date().toISOString()));
      }
      await Promise.all(commits);
      const listed = await store.list();
      expect(listed.length).toBe(5);
    });
  });
});
