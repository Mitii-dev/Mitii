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

  it('rebuilds when force is true or a tracked file changes', async () => {
    const Database = require('better-sqlite3') as new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => unknown;
    const root = await mkdtemp(join(tmpdir(), 'mitii-full-index-force-'));

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

      const first = await runFullWorkspaceIndex(common);
      const forced = await runFullWorkspaceIndex({
        ...common,
        force: true,
      });
      await writeFile(
        join(root, 'src', 'app.py'),
        'def foo():\n    return 2\n',
        'utf8',
      );
      const edited = await runFullWorkspaceIndex(common);

      expect(first.status).toBe('indexed');
      expect(forced.status).toBe('indexed');
      expect(edited.status).toBe('indexed');
      expect(edited.indexing.workspaceSnapshotId).not.toBe(
        first.indexing.workspaceSnapshotId,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rebuilds when persisted index format keys are stale', async () => {
    const { writeFileSync } = await import('node:fs');
    const Database = require('better-sqlite3') as new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => unknown;
    const root = await mkdtemp(join(tmpdir(), 'mitii-full-index-format-'));

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

      const first = await runFullWorkspaceIndex(common);
      const metadataPath = join(root, '.mitii', 'index-runtime.json');
      const metadata = JSON.parse(
        await (await import('node:fs/promises')).readFile(metadataPath, 'utf8'),
      ) as Record<string, unknown>;
      metadata.textPipelineVersion = 'chunking-v1';
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      const rebuilt = await runFullWorkspaceIndex(common);

      expect(first.status).toBe('indexed');
      expect(rebuilt.status).toBe('indexed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records call edges for Python when tree-sitter is available', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const Database = require('better-sqlite3') as new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => unknown;
    const root = await mkdtemp(join(tmpdir(), 'mitii-full-index-calls-'));

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, 'src', 'callee.py'),
        'def validate_jwt():\n    return True\n',
        'utf8',
      );
      await writeFile(
        join(root, 'src', 'caller.py'),
        'from callee import validate_jwt\n\ndef main():\n    return validate_jwt()\n',
        'utf8',
      );

      const result = await runFullWorkspaceIndex({
        mitiiDir: join(root, '.mitii'),
        workspaceRoot: root,
        workspaceId: 'test_workspace',
        maximumFiles: 100,
        openDatabase: ((
          filename: string,
          openOptions?: { readonly?: boolean; fileMustExist?: boolean },
        ) => new Database(filename, openOptions)) as never,
      });

      if (result.treeSitter.status !== 'ready') {
        return;
      }

      const graphPath = Object.values(result.graphArtifactPaths)[0];
      expect(graphPath && existsSync(graphPath)).toBe(true);
      const graph = JSON.parse(readFileSync(graphPath!, 'utf8')) as {
        edges: Array<{ type: string }>;
      };
      expect(graph.edges.some((edge) => edge.type === 'calls')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps indexing available when the embedding probe fails', async () => {
    const Database = require('better-sqlite3') as new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => unknown;
    const root = await mkdtemp(join(tmpdir(), 'mitii-full-index-probe-'));

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, 'src', 'app.ts'),
        'export const answer = 42;\n',
        'utf8',
      );

      const result = await runFullWorkspaceIndex({
        mitiiDir: join(root, '.mitii'),
        workspaceRoot: root,
        workspaceId: 'test_workspace',
        maximumFiles: 100,
        openDatabase: ((
          filename: string,
          openOptions?: { readonly?: boolean; fileMustExist?: boolean },
        ) => new Database(filename, openOptions)) as never,
        semanticIndex: {
          enabled: true,
          backend: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
          model: 'nomic-embed-text',
          dimensions: 768,
          normalized: true,
          fetchImpl: async () =>
            new Response('missing model', {
              status: 404,
              statusText: 'Not Found',
            }),
        },
      });

      expect(result.status).toBe('indexed');
      expect(result.vectorIndex.status).toBe('unavailable');
      expect(result.vectorIndex.reason).toContain(
        'ollama pull nomic-embed-text',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not index gitignored files or env secrets', async () => {
    const Database = require('better-sqlite3') as new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => unknown;
    const root = await mkdtemp(join(tmpdir(), 'mitii-full-index-ignore-'));

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await mkdir(join(root, 'tmp'), { recursive: true });
      await writeFile(join(root, '.gitignore'), 'tmp/\nignored.ts\n', 'utf8');
      await writeFile(join(root, 'src', 'app.py'), 'def foo():\n    return 1\n', 'utf8');
      await writeFile(join(root, 'src', 'ignored.ts'), 'export const skip = 1;\n', 'utf8');
      await writeFile(join(root, 'tmp', 'cache.txt'), 'stale\n', 'utf8');
      await writeFile(join(root, '.env'), 'SECRET=1\n', 'utf8');

      const result = await runFullWorkspaceIndex({
        mitiiDir: join(root, '.mitii'),
        workspaceRoot: root,
        workspaceId: 'test_workspace',
        maximumFiles: 100,
        openDatabase: ((
          filename: string,
          openOptions?: { readonly?: boolean; fileMustExist?: boolean },
        ) => new Database(filename, openOptions)) as never,
      });

      const indexed = result.indexing.fileResults.map((file) => file.relativePath);
      expect(result.status).toBe('indexed');
      expect(indexed.some((path) => path.endsWith('src/app.py') || path === 'src/app.py')).toBe(
        true,
      );
      expect(indexed.some((path) => path.includes('ignored.ts'))).toBe(false);
      expect(indexed.some((path) => path.includes('tmp/'))).toBe(false);
      expect(indexed.some((path) => path === '.env' || path.endsWith('/.env'))).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rebuilds when the sqlite file is corrupt', async () => {
    const Database = require('better-sqlite3') as new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => unknown;
    const root = await mkdtemp(join(tmpdir(), 'mitii-full-index-corrupt-'));

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'app.py'), 'def foo():\n    return 1\n', 'utf8');

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

      const first = await runFullWorkspaceIndex(common);
      await rm(join(root, '.mitii', 'repository-index.sqlite-wal'), { force: true });
      await rm(join(root, '.mitii', 'repository-index.sqlite-shm'), { force: true });
      await writeFile(join(root, '.mitii', 'repository-index.sqlite'), 'not a database', 'utf8');
      const rebuilt = await runFullWorkspaceIndex(common);

      expect(first.status).toBe('indexed');
      expect(rebuilt.status).toBe('indexed');
      expect(rebuilt.fileCount).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns cancelled when abort is signaled before indexing', async () => {
    const Database = require('better-sqlite3') as new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => unknown;
    const root = await mkdtemp(join(tmpdir(), 'mitii-full-index-abort-'));

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'app.py'), 'def foo():\n    return 1\n', 'utf8');

      const abort = new AbortController();
      abort.abort();

      await expect(
        runFullWorkspaceIndex({
          mitiiDir: join(root, '.mitii'),
          workspaceRoot: root,
          workspaceId: 'test_workspace',
          maximumFiles: 100,
          abortSignal: abort.signal,
          openDatabase: ((
            filename: string,
            openOptions?: { readonly?: boolean; fileMustExist?: boolean },
          ) => new Database(filename, openOptions)) as never,
        }),
      ).rejects.toThrow(/cancelled/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
