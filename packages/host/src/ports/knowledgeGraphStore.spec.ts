import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createWorkspaceKnowledgeGraph } from './knowledgeGraphStore.js';

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'mitii-kg-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('FileWorkspaceKnowledgeGraphStore', () => {
  it('persists entities and relations as JSONL', async () => {
    await withTempRoot(async (root) => {
      const graph = createWorkspaceKnowledgeGraph(root);
      await graph.createEntities([
        {
          name: 'payments',
          entityType: 'module',
          observations: ['Stripe'],
        },
      ]);
      await graph.createRelations([
        {
          from: 'payments',
          to: 'payments',
          relationType: 'self_check',
        },
      ]);

      const reloaded = createWorkspaceKnowledgeGraph(root);
      const read = await reloaded.search('Stripe');
      expect(read.entities).toHaveLength(1);

      const raw = await readFile(
        join(root, '.mitii', 'memory', 'graph.jsonl'),
        'utf8',
      );
      expect(raw).toContain('"type":"entity"');
      expect(raw).toContain('"type":"relation"');
    });
  });
});
