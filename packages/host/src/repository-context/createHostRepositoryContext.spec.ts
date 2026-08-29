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
                { capability: 'catalog', status: 'ready' },
                { capability: 'map', status: 'ready' },
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

describe('createHostRepositoryContext git priors', () => {
  it('adds dirty git files as git_diff selection origins', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-git-priors-'));

    try {
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      await writeFile(
        join(workspaceRoot, 'src', 'edited.ts'),
        'export function edited() {\n  return true;\n}\n',
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
              capabilities: [
                {
                  capability: 'catalog',
                  status: 'ready',
                },
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
          unstaged: ['src/edited.ts'],
          untracked: [],
          raw: ' M src/edited.ts\n',
        }),
        diff: async () => ({
          diff: '',
          truncated: false,
        }),
      };

      const repositoryContext = createHostRepositoryContext({
        repositoryState,
        workspaceRoot,
        git,
        openDatabase: (() => {
          throw new Error('text index database should not be opened');
        }) as never,
      });

      const result = await repositoryContext.execute({
        state: published.reference,
        query: 'diagnose the local edit',
        mode: 'plan',
        selectionBudget: {
          maximumItems: 4,
          maximumFiles: 4,
          maximumTokens: 4_000,
        },
      });

      expect(result.status).not.toBe('failed');
      expect(
        result.selection.items.some(
          (item) =>
            item.relativePath === 'src/edited.ts' &&
            item.origin.includes('git_diff'),
        ),
      ).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('records a warning when git status fails', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-git-fail-'));

    try {
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
                {
                  capability: 'catalog',
                  status: 'ready',
                },
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
        status: async () => {
          throw new Error('git missing');
        },
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
        query: 'diagnose the local edit',
        mode: 'plan',
      });

      expect(result.warnings.some((warning) => warning.code === 'git_status_unavailable')).toBe(
        true,
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('does not include untracked files unless explicitly enabled', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-git-untracked-'));

    try {
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      await writeFile(
        join(workspaceRoot, 'src', 'scratch.ts'),
        'export const scratch = true;\n',
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
              capabilities: [
                {
                  capability: 'catalog',
                  status: 'ready',
                },
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
          unstaged: [],
          untracked: ['src/scratch.ts'],
          raw: '?? src/scratch.ts\n',
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
        query: 'what changed',
        mode: 'plan',
      });

      expect(
        result.selection.items.some((item) => item.relativePath === 'src/scratch.ts'),
      ).toBe(false);
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
                { capability: 'catalog', status: 'ready' },
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
                { capability: 'catalog', status: 'ready' },
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
      expect(result.assembly.blocks[0]?.content ?? '').toContain('src/present.ts');
      expect(result.assembly.dropped.length).toBeGreaterThan(0);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

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
                { capability: 'catalog', status: 'ready' },
                { capability: 'textIndex', status: 'ready' },
                { capability: 'map', status: 'ready' },
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
                { capability: 'catalog', status: 'ready' },
                { capability: 'textIndex', status: 'ready' },
                { capability: 'map', status: 'ready' },
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
                { capability: 'catalog', status: 'ready' },
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
