import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  corpusIndexExists,
  loadCorpusIndex,
  runCorpusIndex,
} from './corpusIndex.js';
import { CorpusRetrievalSource } from './CorpusRetrievalSource.js';

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'mitii-corpus-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('corpusIndex', () => {
  it('indexes markdown/text under .mitii/corpus into index.json', async () => {
    await withTempRoot(async (root) => {
      const corpusDir = join(root, '.mitii', 'corpus');
      await mkdir(corpusDir, { recursive: true });
      await writeFile(
        join(corpusDir, 'playbook.md'),
        '# Deploy\n\nPrefer blue-green deploys for api services.\n',
        'utf8',
      );
      await writeFile(
        join(corpusDir, 'notes.txt'),
        'Rollback checklist: drain, switch, verify health.\n',
        'utf8',
      );
      await writeFile(join(corpusDir, 'skip.bin'), 'not text', 'utf8');

      const index = await runCorpusIndex({ workspaceRoot: root });
      expect(index.schemaVersion).toBe(1);
      expect(index.files.map((file) => file.relativePath).sort()).toEqual([
        '.mitii/corpus/notes.txt',
        '.mitii/corpus/playbook.md',
      ]);
      expect(index.statistics.chunks).toBeGreaterThan(0);
      expect(corpusIndexExists(root)).toBe(true);

      const loaded = await loadCorpusIndex(root);
      expect(loaded?.files).toHaveLength(2);
      expect(
        loaded?.files.some((file) =>
          file.chunks.some((chunk) => chunk.excerpt.includes('blue-green')),
        ),
      ).toBe(true);
    });
  });

  it('CorpusRetrievalSource returns corpus-provenance candidates', async () => {
    await withTempRoot(async (root) => {
      const corpusDir = join(root, '.mitii', 'corpus');
      await mkdir(corpusDir, { recursive: true });
      await writeFile(
        join(corpusDir, 'runbooks.md'),
        'Incident playbook: page on-call then freeze deploys.\n',
        'utf8',
      );
      const index = await runCorpusIndex({ workspaceRoot: root });
      const source = new CorpusRetrievalSource({ workspaceRoot: root, index });

      expect(source.id).toBe('corpus');
      expect(source.canRetrieve({ query: 'on-call' })).toBe(true);

      const result = await source.retrieve({
        query: 'on-call freeze deploys',
        rootIds: ['workspace'],
        maximumCandidatesPerSource: 5,
      });
      expect(result.status).toBe('complete');
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0]?.relativePath).toContain('.mitii/corpus/');
      expect(result.candidates[0]?.reasons[0]?.evidence).toMatch(/^corpus:/);
    });
  });
});
