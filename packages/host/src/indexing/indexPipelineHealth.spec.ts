import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  formatIndexPipelineHealthLines,
  readIndexPipelineHealth,
} from './indexPipelineHealth.js';
import type { IndexRuntimeMetadata } from './semanticIndex.js';

function writeMeta(
  mitiiDir: string,
  partial: Partial<IndexRuntimeMetadata> &
    Pick<IndexRuntimeMetadata, 'workspaceId'>,
): void {
  const sqlitePath = join(mitiiDir, 'repository-index.sqlite');
  const lanceDbPath = join(mitiiDir, 'lancedb');
  writeFileSync(sqlitePath, '');
  mkdirSync(lanceDbPath, { recursive: true });
  const meta: IndexRuntimeMetadata = {
    schemaVersion: 1,
    workspaceId: partial.workspaceId,
    sqlitePath: partial.sqlitePath ?? sqlitePath,
    lanceDbPath: partial.lanceDbPath ?? lanceDbPath,
    generatedAt: partial.generatedAt ?? '2026-10-01T12:00:00.000Z',
    fileCount: partial.fileCount ?? 3,
    truncated: partial.truncated ?? false,
    textIndexSchemaVersion: partial.textIndexSchemaVersion ?? 3,
    treeSitterRuntime: partial.treeSitterRuntime ?? 'ready',
    ...(partial.embeddingProfile
      ? { embeddingProfile: partial.embeddingProfile }
      : {}),
    ...(partial.lastEmbeddingError
      ? { lastEmbeddingError: partial.lastEmbeddingError }
      : {}),
    ...(partial.lastIndexingResult
      ? { lastIndexingResult: partial.lastIndexingResult }
      : {}),
    ...(partial.graphRevisionByRoot
      ? { graphRevisionByRoot: partial.graphRevisionByRoot }
      : {}),
    ...(partial.mapRevisionByRoot
      ? { mapRevisionByRoot: partial.mapRevisionByRoot }
      : {}),
    ...(partial.catalogRevisionByRoot
      ? { catalogRevisionByRoot: partial.catalogRevisionByRoot }
      : {}),
  };
  writeFileSync(
    join(mitiiDir, 'index-runtime.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
}

describe('readIndexPipelineHealth', () => {
  it('reports missing when .mitii has no index artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-health-missing-'));
    try {
      const health = readIndexPipelineHealth({
        workspaceRoot: root,
        probeNative: false,
      });
      expect(health.overall).toBe('missing');
      expect(health.pipelines.codeIndex.status).toBe('missing');
      expect(health.pipelines.textFts.status).toBe('missing');
      expect(health.pipelines.embeddings.status).toBe('missing');
      expect(health.native.sqlite).toBe('unknown');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports lexical_only when FTS is ready but embeddings are not', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-health-lexical-'));
    const mitiiDir = join(root, '.mitii');
    mkdirSync(mitiiDir, { recursive: true });
    try {
      writeMeta(mitiiDir, {
        workspaceId: 'ws-1',
        lastIndexingResult: {
          schemaVersion: 1,
          workspace: 'ws-1',
          workspaceSnapshotId: 'snap-1',
          status: 'complete',
          indexedAt: Date.now(),
          cleanupAllowed: true,
          fileResultsTruncated: false,
          rootResults: [
            {
              rootId: 'root',
              status: 'complete',
              cleanupPerformed: false,
              codeIndexRemovedFiles: 0,
              textIndexRemovedDocuments: 0,
              textIndexRemovedChunks: 0,
              codeIndexRevision: 7,
              finalTextRevision: 4,
              embeddedChunks: 0,
              vectorsDeleted: 0,
              warnings: [],
            },
          ],
          fileResults: [],
          warnings: [],
          statistics: {
            availableFiles: 3,
            selectedFiles: 3,
            skippedFiles: 0,
            processedFiles: 3,
            completeFiles: 3,
            partialFiles: 0,
            failedFiles: 0,
            cancelledFiles: 0,
            skippedByPolicy: 0,
          },
        } as IndexRuntimeMetadata['lastIndexingResult'],
        graphRevisionByRoot: { root: 'g1' },
        mapRevisionByRoot: { root: 'm1' },
        catalogRevisionByRoot: { root: 'c1' },
      });

      const health = readIndexPipelineHealth({
        workspaceRoot: root,
        probeNative: false,
      });
      expect(health.pipelines.codeIndex.status).toBe('ready');
      expect(health.pipelines.codeIndex.revision).toBe('7');
      expect(health.pipelines.textFts.status).toBe('ready');
      expect(health.pipelines.textFts.revision).toBe('4');
      expect(health.pipelines.embeddings.status).toBe('unavailable');
      expect(health.pipelines.graph.status).toBe('ready');
      expect(health.pipelines.map.status).toBe('ready');
      expect(health.pipelines.treeSitter.status).toBe('ready');
      expect(health.overall).toBe('lexical_only');

      const lines = formatIndexPipelineHealthLines(health);
      expect(lines.some((line) => line.includes('Code Index=ready'))).toBe(
        true,
      );
      expect(lines.some((line) => line.includes('Text FTS5=ready'))).toBe(true);
      expect(lines.some((line) => line.includes('Embeddings=unavailable'))).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports ready when embedding profile and LanceDB path exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-health-ready-'));
    const mitiiDir = join(root, '.mitii');
    mkdirSync(mitiiDir, { recursive: true });
    try {
      writeMeta(mitiiDir, {
        workspaceId: 'ws-2',
        embeddingProfile: {
          id: 'bundled-minilm',
          providerId: 'bundled',
          modelId: 'all-MiniLM-L6-v2',
          dimensions: 384,
          normalized: true,
        },
        lastIndexingResult: {
          schemaVersion: 1,
          workspace: 'ws-2',
          workspaceSnapshotId: 'snap-2',
          status: 'complete',
          indexedAt: Date.now(),
          cleanupAllowed: true,
          fileResultsTruncated: false,
          rootResults: [
            {
              rootId: 'root',
              status: 'complete',
              cleanupPerformed: false,
              codeIndexRemovedFiles: 0,
              textIndexRemovedDocuments: 0,
              textIndexRemovedChunks: 0,
              codeIndexRevision: 1,
              finalTextRevision: 1,
              embeddingStatus: 'complete',
              embeddingProfileId: 'bundled-minilm',
              embeddedChunks: 2,
              vectorsDeleted: 0,
              warnings: [],
            },
          ],
          fileResults: [],
          warnings: [],
          statistics: {
            availableFiles: 1,
            selectedFiles: 1,
            skippedFiles: 0,
            processedFiles: 1,
            completeFiles: 1,
            partialFiles: 0,
            failedFiles: 0,
            cancelledFiles: 0,
            skippedByPolicy: 0,
          },
        } as IndexRuntimeMetadata['lastIndexingResult'],
        graphRevisionByRoot: { root: 'g1' },
        mapRevisionByRoot: { root: 'm1' },
      });

      const health = readIndexPipelineHealth({
        workspaceRoot: root,
        probeNative: false,
      });
      expect(health.pipelines.embeddings.status).toBe('ready');
      expect(health.pipelines.embeddings.profileId).toBe('bundled-minilm');
      expect(health.overall).toBe('ready');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('surfaces lastEmbeddingError as embeddings degraded', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-health-embed-err-'));
    const mitiiDir = join(root, '.mitii');
    mkdirSync(mitiiDir, { recursive: true });
    try {
      writeMeta(mitiiDir, {
        workspaceId: 'ws-3',
        lastEmbeddingError: 'onnx_load_failed',
        lastIndexingResult: {
          schemaVersion: 1,
          workspace: 'ws-3',
          workspaceSnapshotId: 'snap-3',
          status: 'complete',
          indexedAt: Date.now(),
          cleanupAllowed: true,
          fileResultsTruncated: false,
          rootResults: [
            {
              rootId: 'root',
              status: 'complete',
              cleanupPerformed: false,
              codeIndexRemovedFiles: 0,
              textIndexRemovedDocuments: 0,
              textIndexRemovedChunks: 0,
              codeIndexRevision: 2,
              finalTextRevision: 2,
              embeddedChunks: 0,
              vectorsDeleted: 0,
              warnings: [],
            },
          ],
          fileResults: [],
          warnings: [],
          statistics: {
            availableFiles: 1,
            selectedFiles: 1,
            skippedFiles: 0,
            processedFiles: 1,
            completeFiles: 1,
            partialFiles: 0,
            failedFiles: 0,
            cancelledFiles: 0,
            skippedByPolicy: 0,
          },
        } as IndexRuntimeMetadata['lastIndexingResult'],
      });

      const health = readIndexPipelineHealth({
        workspaceRoot: root,
        probeNative: false,
      });
      expect(health.pipelines.embeddings.status).toBe('degraded');
      expect(health.pipelines.embeddings.reason).toBe('onnx_load_failed');
      expect(health.lastError).toBe('onnx_load_failed');
      expect(health.overall).toBe('lexical_only');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
