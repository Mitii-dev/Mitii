import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizePathSearchNeedle,
  searchWorkspacePaths,
} from '../src/engine/explorer/workspaceFs.js';

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

  it('finds Mitii request-intake beside huge *-ref clones (ai-agents layout)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-desktop-path-ai-agents-'));
    try {
      // Sibling clone noise that used to fill the catalog first.
      for (let i = 0; i < 40; i += 1) {
        const dir = join(root, 'desktop-ref', 'n8n-master', `pkg${i}`);
        await mkdir(dir, { recursive: true });
        for (let j = 0; j < 30; j += 1) {
          await writeFile(join(dir, `file${j}.ts`), '');
        }
      }
      await mkdir(
        join(root, 'Mitii', 'packages', 'v8', 'src', 'modules', 'request-intake'),
        { recursive: true },
      );
      await writeFile(
        join(
          root,
          'Mitii',
          'packages',
          'v8',
          'src',
          'modules',
          'request-intake',
          'index.ts',
        ),
        '',
      );

      const byHyphen = await searchWorkspacePaths(root, 'request-intake');
      expect(byHyphen).toEqual(
        expect.arrayContaining([
          {
            path: 'Mitii/packages/v8/src/modules/request-intake',
            kind: 'folder',
          },
        ]),
      );

      const bySpaces = await searchWorkspacePaths(root, 'request intake');
      expect(bySpaces.some((h) => h.path.endsWith('request-intake'))).toBe(
        true,
      );
      expect(byHyphen.some((h) => h.path.includes('desktop-ref'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('normalizePathSearchNeedle', () => {
  it('maps spaced names to hyphen form', () => {
    expect(normalizePathSearchNeedle('request intake')).toBe('request-intake');
    expect(normalizePathSearchNeedle('@request_intake')).toBe('request-intake');
  });
});
