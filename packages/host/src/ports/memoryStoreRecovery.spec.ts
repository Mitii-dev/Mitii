import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { MEMORY_SCHEMA_VERSION, MemoryPipeline } from '@mitii/v8';

import {
  createWorkspaceMemoryStore,
  MemoryStorageError,
  memoryStorageErrorCodeSchema,
} from '../index.js';

const scope = { kind: 'workspace' as const, workspaceId: 'ws-recovery' };
const at = '2026-09-28T00:00:00.000Z';
const fact = {
  id: 'original', content: 'Keep this workspace preference.', scope,
  privacy: 'shareable' as const, createdAt: at, source: 'user',
};

async function withStore(run: (root: string, path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'mitii-memory-recovery-'));
  const path = join(root, '.mitii', 'memory', 'facts.json');
  try {
    await mkdir(join(root, '.mitii', 'memory'), { recursive: true });
    await run(root, path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const unreadable = [
  { name: 'empty file', raw: '', code: 'memory_storage_corrupt' },
  { name: 'invalid JSON', raw: '{broken-original', code: 'memory_storage_corrupt' },
  { name: 'null envelope', raw: 'null', code: 'memory_storage_corrupt' },
  { name: 'invalid facts', raw: '{"storageVersion":2,"facts":{}}', code: 'memory_storage_corrupt' },
  { name: 'missing version', raw: '{"facts":[]}', code: 'memory_storage_corrupt' },
  { name: 'unrecognized envelope metadata', raw: '{"storageVersion":2,"facts":[],"futureData":"preserve"}', code: 'memory_storage_corrupt' },
  { name: 'future version', raw: '{"storageVersion":99,"facts":[]}', code: 'memory_storage_version_unsupported' },
];

describe('file memory recovery boundary', () => {
  it('exports validated stable error codes without storage payloads', () => {
    for (const code of memoryStorageErrorCodeSchema.options) {
      const error = new MemoryStorageError(code);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('MemoryStorageError');
      expect(error.code).toBe(code);
      expect(error.message).not.toContain(fact.content);
    }
    expect(memoryStorageErrorCodeSchema.safeParse('unknown').success).toBe(false);
    expect(memoryStorageErrorCodeSchema.safeParse(null).success).toBe(false);
  });

  it.each(unreadable)('reports $name without returning an empty store', async ({ raw, code }) => {
    await withStore(async (root, path) => {
      await writeFile(path, raw);
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      await expect(store.list()).rejects.toMatchObject({ code });
      await expect(store.query({ scope, query: 'preference' })).rejects.toMatchObject({ code });
      expect(await readFile(path, 'utf8')).toBe(raw);
    });
  });

  it.each(unreadable)('blocks every mutation on $name and preserves original bytes', async ({ raw, code }) => {
    await withStore(async (root, path) => {
      await writeFile(path, raw);
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      for (const operation of [
        () => store.commit(fact),
        () => store.recordAccess([fact.id], at),
        () => store.delete(fact.id),
        () => store.delete('missing'),
      ]) {
        await expect(operation()).rejects.toMatchObject({ code });
        expect(await readFile(path, 'utf8')).toBe(raw);
      }
      expect(await readdir(join(root, '.mitii', 'memory'))).toEqual(['facts.json']);
    });
  });

  it('reads valid rows but refuses to discard malformed rows during mutation', async () => {
    await withStore(async (root, path) => {
      const raw = JSON.stringify({ storageVersion: 2, facts: [fact, { id: 'bad', content: 123 }] });
      await writeFile(path, raw);
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      expect((await store.query({ scope, query: 'preference' })).map(row => row.id)).toEqual([fact.id]);
      for (const operation of [
        () => store.commit({ ...fact, id: 'new' }),
        () => store.recordAccess([fact.id], at),
        () => store.delete(fact.id),
      ]) {
        await expect(operation()).rejects.toMatchObject({ code: 'memory_storage_recovery_required' });
        expect(await readFile(path, 'utf8')).toBe(raw);
      }
    });
  });

  it.each([
    { ...fact, createdAt: 'invalid date' },
    { ...fact, expiresAt: 'invalid expiry' },
    { ...fact, accessCount: 'invalid count' },
    { ...fact, futureField: 'must not be discarded' },
  ])('does not normalize invalid stored metadata into writable data: %j', async row => {
    await withStore(async (root, path) => {
      const raw = JSON.stringify({ storageVersion: 2, facts: [row] });
      await writeFile(path, raw);
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      await expect(store.commit(fact)).rejects.toMatchObject({ code: 'memory_storage_recovery_required' });
      expect(await readFile(path, 'utf8')).toBe(raw);
    });
  });

  it('blocks mutation when duplicate IDs would silently discard another row', async () => {
    await withStore(async (root, path) => {
      const raw = JSON.stringify({ storageVersion: 2, facts: [fact, { ...fact, content: 'Other evidence.' }] });
      await writeFile(path, raw);
      await expect(createWorkspaceMemoryStore(root, scope.workspaceId).commit(fact))
        .rejects.toMatchObject({ code: 'memory_storage_recovery_required' });
      expect(await readFile(path, 'utf8')).toBe(raw);
    });
  });

  it('accepts supported legacy data and initializes a missing store', async () => {
    await withStore(async (root, path) => {
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      expect(await store.list()).toEqual([]);
      await store.commit(fact);
      expect((await store.list())[0]?.id).toBe(fact.id);
      await writeFile(path, JSON.stringify({ storageVersion: 1, facts: [{
        id: 'legacy', content: 'A legacy fact.', createdAt: '2026-09-27T19:00:00-05:00',
      }] }));
      await store.commit(fact);
      const rows = await store.list();
      expect(rows.map(row => row.id)).toEqual(['legacy', fact.id]);
      expect(rows[0]).toMatchObject({ scope, createdAt: at, privacy: 'shareable' });
      expect(JSON.parse(await readFile(path, 'utf8')).storageVersion).toBe(2);
    });
  });

  it('rechecks disk after recovery instead of permanently poisoning the queue', async () => {
    await withStore(async (root, path) => {
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      await writeFile(path, 'broken');
      await expect(store.commit(fact)).rejects.toMatchObject({ code: 'memory_storage_corrupt' });
      await writeFile(path, JSON.stringify({ storageVersion: 2, facts: [fact] }));
      await store.commit({ ...fact, id: 'after-recovery' });
      expect((await store.list()).map(row => row.id)).toEqual([fact.id, 'after-recovery']);
    });
  });

  it('rejects invalid access updates without filtering away the fact', async () => {
    await withStore(async (root, path) => {
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      await store.commit(fact);
      const before = await readFile(path, 'utf8');
      await expect(store.recordAccess([fact.id], 'invalid')).rejects.toMatchObject({ code: 'memory_storage_invalid_fact' });
      expect(await readFile(path, 'utf8')).toBe(before);
    });
  });

  it('rejects an invalid commit without altering existing facts', async () => {
    await withStore(async (root, path) => {
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      await store.commit(fact);
      const before = await readFile(path, 'utf8');
      await expect(store.commit({ ...fact, content: '' }))
        .rejects.toMatchObject({ code: 'memory_storage_invalid_fact' });
      expect(await readFile(path, 'utf8')).toBe(before);
    });
  });

  it('propagates filesystem read failures instead of treating them as a cold start', async () => {
    await withStore(async (root, path) => {
      await mkdir(path);
      const store = createWorkspaceMemoryStore(root, scope.workspaceId);
      await expect(store.list()).rejects.toBeInstanceOf(Error);
      await expect(store.commit(fact)).rejects.toBeInstanceOf(Error);
      expect(await readdir(path)).toEqual([]);
    });
  });

  it('keeps partial-data retrieval usable through the pipeline without writing access metadata', async () => {
    await withStore(async (root, path) => {
      const raw = JSON.stringify({ storageVersion: 2, facts: [fact, { id: 'bad', content: 123 }] });
      await writeFile(path, raw);
      const pipeline = new MemoryPipeline({ store: createWorkspaceMemoryStore(root, scope.workspaceId) });
      const result = await pipeline.retrieve({ schemaVersion: MEMORY_SCHEMA_VERSION, scope, query: 'workspace preference', now: at });
      expect(result.status).toBe('retrieved');
      expect(result.instructions.some(row => row.provenance.memoryId === fact.id)).toBe(true);
      expect(result.warnings.some(warning => warning.includes('Memory access touch failed'))).toBe(true);
      expect(await readFile(path, 'utf8')).toBe(raw);
    });
  });
});
