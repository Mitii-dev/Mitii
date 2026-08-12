import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoGraphSchema, type CodeNavigationPort } from '@mitii/v8';
import { describe, expect, it } from 'vitest';

import { createHostCodeNavigationPort } from './createHostCodeNavigationPort.js';

describe('createHostCodeNavigationPort', () => {
  it('resolves definitions from the published repo graph', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-code-nav-'));

    try {
      await writeGraph(workspaceRoot);
      const port = createHostCodeNavigationPort({ workspaceRoot });
      expect(port.provider).toBe('repo_graph');

      const locations = await port.definition({
        relativePath: 'src/auth.ts',
        line: 6,
      });
      expect(locations[0]?.symbolName).toBe('validateJwt');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('falls back to the graph when the language server returns nothing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-code-nav-lsp-'));

    try {
      await writeGraph(workspaceRoot);
      const languageServer: CodeNavigationPort = {
        id: 'empty-lsp',
        provider: 'language_server',
        definition: async () => [],
        references: async () => [],
      };
      const port = createHostCodeNavigationPort({
        workspaceRoot,
        languageServer,
      });
      expect(port.provider).toBe('language_server');

      const locations = await port.definition({
        relativePath: 'src/auth.ts',
        line: 6,
      });
      expect(locations[0]?.symbolName).toBe('validateJwt');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function writeGraph(workspaceRoot: string): Promise<void> {
  const graph = repoGraphSchema.parse({
    schemaVersion: 1,
    workspaceSnapshotId: 'snapshot',
    codeIndexChangeToken: 'token',
    status: 'complete',
    generatedAt: new Date(0).toISOString(),
    warnings: [],
    nodes: [
      {
        id: 'file:auth.ts',
        kind: 'file',
        fileId: 'file:auth.ts',
        rootId: 'workspace',
        relativePath: 'src/auth.ts',
      },
      {
        id: 'file:login.ts',
        kind: 'file',
        fileId: 'file:login.ts',
        rootId: 'workspace',
        relativePath: 'src/login.ts',
      },
      {
        id: 'sym:validateJwt',
        kind: 'symbol',
        symbolId: 'sym:validateJwt',
        fileId: 'file:auth.ts',
        name: 'validateJwt',
        symbolKind: 'function',
        startLine: 4,
        endLine: 12,
        signature: 'export function validateJwt(token: string): boolean',
      },
      {
        id: 'sym:login',
        kind: 'symbol',
        symbolId: 'sym:login',
        fileId: 'file:login.ts',
        name: 'login',
        symbolKind: 'function',
        startLine: 8,
        endLine: 20,
      },
    ],
    edges: [
      {
        id: 'edge:login-calls-jwt',
        type: 'calls',
        fromNodeId: 'sym:login',
        toNodeId: 'sym:validateJwt',
        weight: 1,
        evidenceCount: 1,
        evidence: [{ source: 'code_index_reference', line: 10 }],
        evidenceTruncated: false,
      },
    ],
    statistics: {
      availableFiles: 2,
      indexedFiles: 2,
      projectNodes: 0,
      fileNodes: 2,
      symbolNodes: 2,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: 0,
      callEdges: 1,
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
      durationMs: 0,
    },
  });

  await mkdir(join(workspaceRoot, '.mitii'), { recursive: true });
  await writeFile(
    join(workspaceRoot, '.mitii', 'repository-graph-workspace.json'),
    JSON.stringify(graph),
    'utf8',
  );
}
