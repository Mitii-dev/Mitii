import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  InMemoryRepositoryStateStore,
  RepositoryStatePipeline,
  publishRepositoryStateInputSchema,
  type GitPort,
} from '@mitii/v8';
import { describe, expect, it } from 'vitest';

import { createHostRepositoryContext } from './createHostRepositoryContext.js';
describe('createHostRepositoryContext hybrid retrieval', () => {
  it('retrieves repo-map candidates when sqlite is missing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-map-retrieve-'));
    const snapshotId =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    try {
      await mkdir(join(workspaceRoot, 'packages', 'demo', 'src'), { recursive: true });
      await writeFile(
        join(workspaceRoot, 'packages', 'demo', 'src', 'used.ts'),
        'export const used = true;\n',
        'utf8',
      );
      await mkdir(join(workspaceRoot, '.mitii'), { recursive: true });
      await writeFile(
        join(workspaceRoot, '.mitii', 'repository-map-workspace.json'),
        JSON.stringify({
          schemaVersion: 1,
          workspaceSnapshotId: snapshotId,
          codeIndexChangeToken: 'index-1',
          entries: [
            {
              file: {
                id: 'file:used',
                rootId: 'workspace',
                relativePath: 'packages/demo/src/used.ts',
              },
              symbols: [],
              score: 0.9,
              pageRank: 0.9,
              inboundImportCount: 1,
              outboundImportCount: 0,
              inboundReferenceCount: 0,
              outboundReferenceCount: 0,
              reasons: [],
            },
          ],
          statistics: {
            availableFiles: 1,
            rankedFiles: 1,
            includedFiles: 1,
            includedSymbols: 0,
            estimatedTokens: 20,
            durationMs: 0,
          },
          status: 'complete',
          generatedAt: new Date(0).toISOString(),
        }),
        'utf8',
      );

      const repositoryState = new RepositoryStatePipeline({
        store: new InMemoryRepositoryStateStore(),
      });
      const published = await repositoryState.publish(
        publishRepositoryStateInputSchema.parse({
          schemaVersion: 1,
          workspaceId: 'workspace-test',
          snapshotId,
          scanCompleteness: 'complete',
          roots: [
            {
              rootId: 'workspace',
              projectCatalogRevision: 'catalog-1',
              textIndexRevision: 'text-1',
              mapRevision: 'map-1',
              capabilities: [
                { capability: 'catalog', status: 'available' },
                { capability: 'textIndex', status: 'available' },
                { capability: 'map', status: 'available' },
              ],
            },
          ],
          reasons: [],
          generatedAt: new Date(0).toISOString(),
        }),
      );
      expect(published.status).toBe('published');
      if (published.status !== 'published') return;

      const result = await createHostRepositoryContext({
        repositoryState,
        workspaceRoot,
        openDatabase: (() => {
          throw new Error('text index database should not be opened');
        }) as never,
      }).execute({
        state: published.reference,
        query: 'fix types in this package',
        mode: 'agent',
        folderPrefix: 'packages/demo',
      });

      expect(result.retrieval.candidates.length).toBeGreaterThan(0);
      expect(
        result.retrieval.candidates.some(
          (candidate) => candidate.relativePath === 'packages/demo/src/used.ts',
        ),
      ).toBe(true);
      expect(
        result.warnings.some((warning) => warning.code === 'optional_source_unavailable'),
      ).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('keeps scoped package files loadable after many earlier workspace files', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-wide-snapshot-'));
    const snapshotId =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    try {
      await mkdir(join(workspaceRoot, 'apps', 'docs', 'src'), { recursive: true });
      for (let index = 0; index < 450; index += 1) {
        await writeFile(
          join(
            workspaceRoot,
            'apps',
            'docs',
            'src',
            `noise-${String(index).padStart(3, '0')}.ts`,
          ),
          `export const noise${index} = ${index};\n`,
          'utf8',
        );
      }
      await mkdir(join(workspaceRoot, 'packages', 'demo', 'src'), { recursive: true });
      await writeFile(
        join(workspaceRoot, 'packages', 'demo', 'src', 'target.ts'),
        'export const target = true;\n',
        'utf8',
      );
      await mkdir(join(workspaceRoot, '.mitii'), { recursive: true });
      await writeFile(
        join(workspaceRoot, '.mitii', 'repository-map-workspace.json'),
        JSON.stringify({
          schemaVersion: 1,
          workspaceSnapshotId: snapshotId,
          codeIndexChangeToken: 'index-1',
          entries: [
            {
              file: {
                id: 'file:target',
                rootId: 'workspace',
                relativePath: 'packages/demo/src/target.ts',
              },
              symbols: [],
              score: 0.9,
              pageRank: 0.9,
              inboundImportCount: 1,
              outboundImportCount: 0,
              inboundReferenceCount: 0,
              outboundReferenceCount: 0,
              reasons: [],
            },
          ],
          statistics: {
            availableFiles: 1,
            rankedFiles: 1,
            includedFiles: 1,
            includedSymbols: 0,
            estimatedTokens: 20,
            durationMs: 0,
          },
          status: 'complete',
          generatedAt: new Date(0).toISOString(),
        }),
        'utf8',
      );

      const repositoryState = new RepositoryStatePipeline({
        store: new InMemoryRepositoryStateStore(),
      });
      const published = await repositoryState.publish(
        publishRepositoryStateInputSchema.parse({
          schemaVersion: 1,
          workspaceId: 'workspace-test',
          snapshotId,
          scanCompleteness: 'partial',
          roots: [
            {
              rootId: 'workspace',
              projectCatalogRevision: 'catalog-1',
              textIndexRevision: 'text-1',
              mapRevision: 'map-1',
              capabilities: [
                { capability: 'catalog', status: 'available' },
                { capability: 'textIndex', status: 'available' },
                { capability: 'map', status: 'available' },
              ],
            },
          ],
          reasons: [],
          generatedAt: new Date(0).toISOString(),
        }),
      );
      expect(published.status).toBe('published');
      if (published.status !== 'published') return;

      const result = await createHostRepositoryContext({
        repositoryState,
        workspaceRoot,
        openDatabase: (() => {
          throw new Error('text index database should not be opened');
        }) as never,
      }).execute({
        state: published.reference,
        query: 'fix types in this package',
        mode: 'agent',
        folderPrefix: 'packages/demo',
        selectionBudget: {
          maximumItems: 4,
          maximumFiles: 4,
          maximumTokens: 4_000,
        },
      });

      expect(result.status).not.toBe('failed');
      expect(
        result.assembly.blocks.some(
          (block) =>
            block.relativePath === 'packages/demo/src/target.ts' &&
            block.content.includes('export const target'),
        ),
      ).toBe(true);
      expect(
        result.assembly.blocks.some((block) =>
          (block.content ?? '').includes('apps/docs'),
        ),
      ).toBe(false);
      expect(
        result.warnings.some(
          (warning) =>
            warning.code === 'file_map_fallback' &&
            warning.message.includes('zero file bodies'),
        ),
      ).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('does not select git files outside the mentioned folder', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-folder-git-'));

    try {
      await mkdir(join(workspaceRoot, 'packages', 'demo', 'src'), { recursive: true });
      await writeFile(
        join(workspaceRoot, 'packages', 'demo', 'src', 'used.ts'),
        'export const used = true;\n',
        'utf8',
      );
      await writeFile(join(workspaceRoot, '.gitignore'), 'node_modules\n', 'utf8');

      const repositoryState = new RepositoryStatePipeline({
        store: new InMemoryRepositoryStateStore(),
      });
      const published = await repositoryState.publish(
        publishRepositoryStateInputSchema.parse({
          schemaVersion: 1,
          workspaceId: 'workspace-test',
          snapshotId:
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          scanCompleteness: 'complete',
          roots: [
            {
              rootId: 'workspace',
              projectCatalogRevision: 'catalog-1',
              capabilities: [
                { capability: 'catalog', status: 'available' },
              ],
            },
          ],
          reasons: [],
          generatedAt: new Date(0).toISOString(),
        }),
      );
      expect(published.status).toBe('published');
      if (published.status !== 'published') return;

      const git: GitPort = {
        status: async () => ({
          branch: 'main',
          staged: [],
          unstaged: ['.gitignore', 'packages/demo/src/used.ts'],
          untracked: [],
          raw: ' M .gitignore\n M packages/demo/src/used.ts\n',
        }),
        diff: async () => ({
          diff: '',
          truncated: false,
        }),
      };

      const result = await createHostRepositoryContext({
        repositoryState,
        workspaceRoot,
        git,
        openDatabase: (() => {
          throw new Error('text index database should not be opened');
        }) as never,
      }).execute({
        state: published.reference,
        query: 'fix types in this package',
        mode: 'agent',
        folderPrefix: 'packages/demo',
        selectionBudget: {
          maximumItems: 4,
          maximumFiles: 4,
          maximumTokens: 4_000,
        },
      });

      expect(
        result.selection.items.some(
          (item) => item.relativePath === 'packages/demo/src/used.ts',
        ),
      ).toBe(true);
      expect(
        result.selection.items.some((item) => item.relativePath === '.gitignore'),
      ).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
