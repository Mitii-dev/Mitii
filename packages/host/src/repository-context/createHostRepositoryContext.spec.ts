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
