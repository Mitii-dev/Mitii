import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { searchWorkspacePaths } from '../src/engine/workspace-fs.js';

describe('searchWorkspacePaths', () => {
  it('includes matching folders and files in @ mention results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-desktop-path-search-'));
    try {
      await mkdir(join(root, 'src', 'features'), { recursive: true });
      await mkdir(join(root, 'node_modules', 'ignored'), { recursive: true });
      await writeFile(join(root, 'src', 'features', 'agentRunner.ts'), '');
      await writeFile(join(root, 'src', 'index.ts'), '');
      await writeFile(
        join(root, 'node_modules', 'ignored', 'agentRunner.ts'),
        '',
      );

      await expect(searchWorkspacePaths(root, '')).resolves.toEqual(
        expect.arrayContaining([
          { path: 'src', kind: 'folder' },
          { path: 'src/features', kind: 'folder' },
          { path: 'src/index.ts', kind: 'file' },
        ]),
      );

      const filtered = await searchWorkspacePaths(root, 'features');
      expect(filtered).toEqual(
        expect.arrayContaining([{ path: 'src/features', kind: 'folder' }]),
      );
      expect(filtered.some((item) => item.path.includes('node_modules'))).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
