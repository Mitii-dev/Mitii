import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoGraphSchema, type RepoGraph } from '@mitii/v8';
import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_DIRTY_CHANGE_TOKEN_SUFFIX,
  createHostRepositoryGraphPort,
  resolveExpectedCodeIndexChangeToken,
  workspaceGraphLooksStale,
} from './loadWorkspaceGraphs.js';

describe('createHostRepositoryGraphPort', () => {
  it('loads published graphs and resolves expected index tokens from metadata', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-repo-graph-'));

    try {
      const mitiiDir = join(workspaceRoot, '.mitii');
      await mkdir(mitiiDir, { recursive: true });
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      const filePath = join(workspaceRoot, 'src', 'auth.ts');
      await writeFile(filePath, 'export const auth = 1;\n');
      const old = new Date('2026-08-12T00:00:00.000Z');
      await utimes(filePath, old, old);

      const graph = sampleGraph({
        relativePath: 'src/auth.ts',
        generatedAt: '2026-08-13T00:00:00.000Z',
      });
      const graphPath = join(mitiiDir, 'repository-graph-workspace.json');
      await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
      await writeFile(
        join(mitiiDir, 'index-runtime.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            workspaceId: 'ws',
            sqlitePath: join(mitiiDir, 'repository-index.sqlite'),
            lanceDbPath: join(mitiiDir, 'lancedb'),
            graphArtifactPaths: { workspace: graphPath },
            graphRevisionByRoot: { workspace: 'metadata-token-newer' },
            snapshotFingerprint: 'snapshot-1',
            generatedAt: '2026-08-13T00:00:00.000Z',
          },
          null,
          2,
        )}\n`,
      );

      const port = createHostRepositoryGraphPort({ workspaceRoot });
      const graphs = await port.loadGraphs();
      expect(graphs).toHaveLength(1);
      expect(graphs[0]?.codeIndexChangeToken).toBe('token-1');

      const expected = await port.expectedCodeIndexChangeToken?.(graphs[0]!);
      expect(expected).toBe('metadata-token-newer');
      expect(resolveExpectedCodeIndexChangeToken(workspaceRoot, graphs[0]!)).toBe(
        'metadata-token-newer',
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('marks graphs stale when a graph file is newer than generatedAt', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-repo-graph-dirty-'));

    try {
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      await mkdir(join(workspaceRoot, '.mitii'), { recursive: true });
      const filePath = join(workspaceRoot, 'src', 'auth.ts');
      await writeFile(filePath, 'export const auth = 1;\n');

      const graph = sampleGraph({
        relativePath: 'src/auth.ts',
        generatedAt: '2020-01-01T00:00:00.000Z',
      });
      expect(workspaceGraphLooksStale(workspaceRoot, graph)).toBe(true);

      const expected = resolveExpectedCodeIndexChangeToken(workspaceRoot, graph);
      expect(expected).toBe(`token-1${WORKSPACE_DIRTY_CHANGE_TOKEN_SUFFIX}`);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function sampleGraph(options: {
  relativePath: string;
  generatedAt: string;
}): RepoGraph {
  return repoGraphSchema.parse({
    schemaVersion: 1,
    workspaceSnapshotId: 'snapshot-1',
    codeIndexChangeToken: 'token-1',
    nodes: [
      {
        id: 'file:auth',
        kind: 'file',
        fileId: 'file:auth',
        rootId: 'workspace',
        relativePath: options.relativePath,
      },
    ],
    edges: [],
    warnings: [],
    statistics: {
      availableFiles: 1,
      indexedFiles: 1,
      projectNodes: 0,
      fileNodes: 1,
      symbolNodes: 0,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: 0,
      callEdges: 0,
      referenceEdges: 0,
      projectRelationshipEdges: 0,
      unresolvedImports: 0,
      omittedImportTargets: 0,
      ambiguousReferences: 0,
      unresolvedReferences: 0,
      omittedReferenceTargets: 0,
      omittedParentSymbolTargets: 0,
      truncatedSymbolFiles: 0,
      droppedSymbolNodes: 0,
      droppedEdges: 0,
      consistencyRetries: 0,
      durationMs: 1,
    },
    status: 'complete',
    generatedAt: options.generatedAt,
  });
}
