import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { searchWorkspacePaths } from '../../../apps/vscode/src/pathSearch.ts';

describe('searchWorkspacePaths', () => {
  it('caches a bounded catalog and filters it across mention queries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-path-search-'));
    try {
      await mkdir(join(root, 'src', 'features'), { recursive: true });
      await mkdir(join(root, 'node_modules', 'ignored'), { recursive: true });
      await writeFile(join(root, 'src', 'features', 'agentRunner.ts'), '');
      await writeFile(join(root, 'src', 'index.ts'), '');
      await writeFile(join(root, 'node_modules', 'ignored', 'agentRunner.ts'), '');

      await expect(searchWorkspacePaths(root, '')).resolves.toEqual(
        expect.arrayContaining([
          { path: 'src', kind: 'folder' },
          { path: 'src/index.ts', kind: 'file' },
        ]),
      );

      const filtered = await searchWorkspacePaths(root, 'agent');

      expect(filtered).toEqual([
        { path: 'src/features/agentRunner.ts', kind: 'file' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
