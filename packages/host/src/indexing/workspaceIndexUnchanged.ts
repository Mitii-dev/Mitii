import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  REPOSITORY_INDEX_FORMAT,
  type WorkspaceIndexingPipelineResult,
} from '@mitii/v8';

import {
  readIndexRuntimeMetadata,
  SEMANTIC_INDEX_DISABLED_REASON,
  type IndexRuntimeMetadata,
} from './semanticIndex.js';
import {
  INDEX_DB_FILE,
  INDEX_RUNTIME_FILE,
  LANCEDB_DIR,
} from './indexArtifactPaths.js';
import type { FullWorkspaceIndexResult } from './workspaceIndexTypes.js';

export function treeSitterStatusFromMetadata(
  status: IndexRuntimeMetadata['treeSitterRuntime'],
): FullWorkspaceIndexResult['treeSitter'] {
  if (status === 'ready') {
    return { status: 'ready' };
  }
  return {
    status: 'unavailable',
    reason:
      'Tree-sitter WASM runtime is unavailable; non-TypeScript languages fall back to regex symbol extraction.',
  };
}

export function hasIndexFormatMismatch(
  metadata: IndexRuntimeMetadata | undefined,
): boolean {
  return (
    metadata?.textIndexSchemaVersion !==
      REPOSITORY_INDEX_FORMAT.textIndexSchemaVersion ||
    metadata?.textPipelineVersion !==
      REPOSITORY_INDEX_FORMAT.textPipelineVersion ||
    metadata?.graphBuilderVersion !==
      REPOSITORY_INDEX_FORMAT.graphBuilderVersion
  );
}

export function isUnchangedFullIndex(input: {
  metadata: IndexRuntimeMetadata | undefined;
  workspaceId: string;
  snapshotFingerprint: string;
  vectorRuntimeKey: string;
  force: boolean;
  scoped: boolean;
  formatMismatch: boolean;
}): input is {
  metadata: IndexRuntimeMetadata & {
    snapshotFingerprint: string;
    fileCount: number;
    truncated: boolean;
    lastIndexingResult: WorkspaceIndexingPipelineResult;
    catalogRevisionByRoot: Record<string, string>;
    graphRevisionByRoot: Record<string, string>;
    mapRevisionByRoot: Record<string, string>;
    graphArtifactPaths: Record<string, string>;
    mapArtifactPaths: Record<string, string>;
  };
  workspaceId: string;
  snapshotFingerprint: string;
  vectorRuntimeKey: string;
  force: boolean;
  scoped: boolean;
  formatMismatch: boolean;
} {
  const metadata = input.metadata;

  if (
    input.force ||
    input.scoped ||
    input.formatMismatch ||
    !metadata ||
    metadata.workspaceId !== input.workspaceId ||
    metadata.snapshotFingerprint !== input.snapshotFingerprint ||
    metadata.vectorRuntimeKey !== input.vectorRuntimeKey ||
    typeof metadata.fileCount !== 'number' ||
    typeof metadata.truncated !== 'boolean' ||
    !metadata.lastIndexingResult ||
    !metadata.catalogRevisionByRoot ||
    !metadata.graphRevisionByRoot ||
    !metadata.mapRevisionByRoot ||
    !metadata.graphArtifactPaths ||
    !metadata.mapArtifactPaths
  ) {
    return false;
  }

  return [
    ...Object.values(metadata.graphArtifactPaths),
    ...Object.values(metadata.mapArtifactPaths),
  ].every((path) => existsSync(path));
}

export function vectorIndexFromMetadata(input: {
  metadata: IndexRuntimeMetadata;
  semanticProfileId?: string;
  lanceDbPath: string;
  runtimeMetadataPath: string;
}): FullWorkspaceIndexResult['vectorIndex'] {
  if (
    input.semanticProfileId &&
    input.metadata.embeddingProfile?.id === input.semanticProfileId
  ) {
    return {
      status: 'ready',
      profileId: input.semanticProfileId,
      lanceDbPath: input.lanceDbPath,
      runtimeMetadataPath: input.runtimeMetadataPath,
    };
  }

  return {
    status: 'unavailable',
    reason: SEMANTIC_INDEX_DISABLED_REASON,
  };
}

export function skippedFromPreviousMetadata(options: {
  mitiiDir: string;
  workspaceId: string;
}): FullWorkspaceIndexResult | undefined {
  const databasePath = join(options.mitiiDir, INDEX_DB_FILE);
  const lanceDbPath = join(options.mitiiDir, LANCEDB_DIR);
  const runtimeMetadataPath = join(options.mitiiDir, INDEX_RUNTIME_FILE);
  const metadata = readIndexRuntimeMetadata(runtimeMetadataPath);
  if (
    !metadata ||
    metadata.workspaceId !== options.workspaceId ||
    !metadata.lastIndexingResult ||
    typeof metadata.fileCount !== 'number'
  ) {
    return undefined;
  }

  return {
    status: 'skipped',
    skipReason: 'locked',
    indexing: metadata.lastIndexingResult,
    fileCount: metadata.fileCount,
    truncated: metadata.truncated ?? false,
    databasePath,
    vectorIndex: vectorIndexFromMetadata({
      metadata,
      semanticProfileId: metadata.embeddingProfile?.id,
      lanceDbPath,
      runtimeMetadataPath,
    }),
    treeSitter: treeSitterStatusFromMetadata(metadata.treeSitterRuntime),
    catalogRevisionByRoot: metadata.catalogRevisionByRoot ?? {},
    graphRevisionByRoot: metadata.graphRevisionByRoot ?? {},
    mapRevisionByRoot: metadata.mapRevisionByRoot ?? {},
    graphArtifactPaths: metadata.graphArtifactPaths ?? {},
    mapArtifactPaths: metadata.mapArtifactPaths ?? {},
  };
}
