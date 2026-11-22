import type { WorkspaceIndexingPipelineResult } from '@mitii/v8';

import type { OpenHostSqliteDatabase } from '../sqlite/types.js';
import type { SemanticIndexSettings } from './semanticIndex.js';
import type { WorkspaceIndexProgress } from './workspaceIndexProgress.js';

export interface FullWorkspaceIndexResult {
  status: 'indexed' | 'unchanged' | 'skipped' | 'cancelled';
  skipReason?: 'locked';
  indexing: WorkspaceIndexingPipelineResult;
  fileCount: number;
  truncated: boolean;
  databasePath: string;
  catalogRevisionByRoot: Record<string, string>;
  graphRevisionByRoot: Record<string, string>;
  mapRevisionByRoot: Record<string, string>;
  graphArtifactPaths: Record<string, string>;
  mapArtifactPaths: Record<string, string>;
  vectorIndex: {
    status: 'ready' | 'unavailable' | 'degraded';
    profileId?: string;
    reason?: string;
    lanceDbPath?: string;
    runtimeMetadataPath?: string;
  };
  treeSitter: {
    status: 'ready' | 'unavailable';
    reason?: string;
  };
}

export interface FullWorkspaceIndexOptions {
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  openDatabase: OpenHostSqliteDatabase;
  maximumFiles?: number;
  /** File-processing concurrency (1–32). Defaults via resolveIndexConcurrency. */
  concurrency?: number;
  semanticIndex?: SemanticIndexSettings;
  force?: boolean;
  filePaths?: readonly string[];
  abortSignal?: AbortSignal;
  onProgress?: (progress: WorkspaceIndexProgress) => void;
  /**
   * Fired after FTS/symbols (+ graph) are durable so hosts can publish a
   * usable state while embeddings continue (degraded vectors until done).
   */
  onLexicalReady?: (partial: FullWorkspaceIndexResult) => void | Promise<void>;
}
