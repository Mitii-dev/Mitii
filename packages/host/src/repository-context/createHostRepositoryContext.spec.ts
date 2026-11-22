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
describe('createHostRepositoryContext file-map fallback', () => {
  it('ranks the empty-selection fallback by repo map score and marks it partial', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-file-map-'));

    try {
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      await writeFile(join(workspaceRoot, 'src', 'alpha.ts'), 'export const alpha = 1;\n', 'utf8');
      await writeFile(join(workspaceRoot, 'src', 'zeta.ts'), 'export const zeta = 1;\n', 'utf8');
      await mkdir(join(workspaceRoot, '.mitii'), { recursive: true });
      await writeFile(
        join(workspaceRoot, '.mitii', 'repository-map-workspace.json'),
        JSON.stringify({
          schemaVersion: 1,
          workspaceSnapshotId:
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          codeIndexChangeToken: 'index-1',
          entries: [
            {
              file: {
                id: 'file:zeta',
                rootId: 'workspace',
                relativePath: 'src/zeta.ts',
              },
              symbols: [],
              score: 0.9,
              pageRank: 0.9,
              inboundImportCount: 4,
              outboundImportCount: 0,
              inboundReferenceCount: 0,
              outboundReferenceCount: 0,
              reasons: [],
            },
            {
              file: {
                id: 'file:alpha',
                rootId: 'workspace',
                relativePath: 'src/alpha.ts',
              },
              symbols: [],
              score: 0.1,
              pageRank: 0.1,
              inboundImportCount: 0,
              outboundImportCount: 0,
              inboundReferenceCount: 0,
              outboundReferenceCount: 0,
              reasons: [],
            },
          ],
          statistics: {
            availableFiles: 2,
            rankedFiles: 2,
            includedFiles: 2,
            includedSymbols: 0,
            estimatedTokens: 40,
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
          snapshotId:
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          scanCompleteness: 'complete',
          roots: [
            {
              rootId: 'workspace',
              projectCatalogRevision: 'catalog-1',
              mapRevision: 'map-1',
              capabilities: [
                { capability: 'catalog', status: 'available' },
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
        query: 'where is the important code',
        mode: 'ask',
      });

      expect(result.status).not.toBe('failed');
      expect(result.retrieval.candidates.length).toBeGreaterThan(0);
      expect(
        result.warnings.some((warning) => warning.code === 'optional_source_unavailable'),
      ).toBe(true);
      const rankedPaths = result.retrieval.candidates.map(
        (candidate) => candidate.relativePath,
      );
      expect(rankedPaths.indexOf('src/zeta.ts')).toBeLessThan(
        rankedPaths.indexOf('src/alpha.ts'),
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('createHostRepositoryContext published root ids', () => {
  it('assembles selected files when the published root id is not workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-root-id-'));

    try {
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      await writeFile(
        join(workspaceRoot, 'src', 'used.ts'),
        'export const used = true;\n',
        'utf8',
      );

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
              rootId: 'app-root',
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
          unstaged: ['src/used.ts'],
          untracked: [],
          raw: ' M src/used.ts\n',
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
        query: 'inspect the local edit',
        mode: 'plan',
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
            block.relativePath === 'src/used.ts' &&
            block.content.includes('export const used'),
        ),
      ).toBe(true);
      expect(
        result.warnings.some((warning) => warning.code === 'file_map_fallback'),
      ).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('falls through to a file map when selected items exist but none assemble', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-empty-assembly-'));

    try {
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      await writeFile(
        join(workspaceRoot, 'src', 'present.ts'),
        'export const present = true;\n',
        'utf8',
      );

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
              rootId: 'app-root',
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
          unstaged: ['src/ghost.ts'],
          untracked: [],
          raw: ' M src/ghost.ts\n',
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
        query: 'inspect the local edit',
        mode: 'plan',
        selectionBudget: {
          maximumItems: 4,
          maximumFiles: 4,
          maximumTokens: 4_000,
        },
      });

      expect(result.selection.items.some((item) => item.relativePath === 'src/ghost.ts')).toBe(
        true,
      );
      expect(result.assembly.blocks.length).toBeGreaterThan(0);
      expect(
        result.warnings.some(
          (warning) =>
            warning.code === 'file_map_fallback' &&
            warning.message.includes('zero file bodies'),
        ),
      ).toBe(true);
      // File-map sketch renders a tree (`src/` + `present.ts`), not a flat path.
      expect(result.assembly.blocks[0]?.content ?? '').toContain('present.ts');
      expect(result.assembly.dropped.length).toBeGreaterThan(0);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
