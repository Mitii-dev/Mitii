import { writeIndexProgress } from './indexLock.js';

export type WorkspaceIndexProgressStage =
  | 'locking'
  | 'scanning'
  | 'indexing'
  | 'lexical_ready'
  | 'embedding'
  | 'graph'
  | 'complete'
  | 'cancelled'
  | 'rebuilding_corrupt';

export interface WorkspaceIndexProgress {
  stage: WorkspaceIndexProgressStage;
  message: string;
  fileCount?: number;
  /** 0–100 estimate for UI (stage-based; not a fake timer). */
  percent?: number;
  /**
   * True when FTS/symbols (+ graph) are published and the project is usable
   * while embeddings may still be running.
   */
  lexicalReady?: boolean;
  /** Embedding phase lifecycle for premium status UI. */
  embeddingPhase?: 'idle' | 'pending' | 'running' | 'ready' | 'degraded' | 'unavailable';
}

/** Conservative stage weights — embedding/graph often dominate wall time. */
export function estimateIndexProgressPercent(
  stage: WorkspaceIndexProgressStage,
): number {
  switch (stage) {
    case 'locking':
      return 2;
    case 'rebuilding_corrupt':
      return 5;
    case 'scanning':
      return 10;
    case 'indexing':
      return 32;
    case 'graph':
      return 48;
    case 'lexical_ready':
      return 55;
    case 'embedding':
      return 72;
    case 'complete':
      return 100;
    case 'cancelled':
      return 0;
    default:
      return 8;
  }
}

export function emitProgress(
  mitiiDir: string,
  onProgress: ((progress: WorkspaceIndexProgress) => void) | undefined,
  progress: WorkspaceIndexProgress,
): void {
  const percent =
    progress.percent ?? estimateIndexProgressPercent(progress.stage);
  const next = { ...progress, percent };
  writeIndexProgress(mitiiDir, {
    stage: next.stage,
    message: next.message,
    percent,
    ...(typeof next.fileCount === 'number' ? { fileCount: next.fileCount } : {}),
    ...(next.lexicalReady ? { lexicalReady: true } : {}),
    ...(next.embeddingPhase ? { embeddingPhase: next.embeddingPhase } : {}),
  });
  onProgress?.(next);
}
