import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';

const require = createRequire(import.meta.url);

describe('full workspace indexing incremental publish', () => {
  it('short-circuits an unchanged second index', async () => {
    const Database = require('better-sqlite3') as new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => unknown;
    const root = await mkdtemp(join(tmpdir(), 'mitii-full-index-'));

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, 'src', 'app.py'),
        'def foo():\n    return 1\n',
        'utf8',
      );

      const common = {
        mitiiDir: join(root, '.mitii'),
        workspaceRoot: root,
        workspaceId: 'test_workspace',
        maximumFiles: 100,
        openDatabase: ((
          filename: string,
          openOptions?: { readonly?: boolean; fileMustExist?: boolean },
        ) => new Database(filename, openOptions)) as never,
      };

      const firstStart = performance.now();
      const first = await runFullWorkspaceIndex(common);
      const firstDuration = performance.now() - firstStart;
      const secondStart = performance.now();
      const second = await runFullWorkspaceIndex(common);
      const secondDuration = performance.now() - secondStart;

      expect(first.status).toBe('indexed');
      expect(second.status).toBe('unchanged');
      expect(second.indexing.workspaceSnapshotId).toBe(
        first.indexing.workspaceSnapshotId,
      );
      expect(secondDuration).toBeLessThan(firstDuration);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
