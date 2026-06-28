import type { IndexingConfig } from '../config/schema';
import type { ThunderDb } from './ThunderDb';
import { SqliteVectorIndex, type VectorIndex } from './VectorIndex';
import { LanceDbVectorIndex, isLanceDbAvailable } from './LanceDbVectorIndex';
import { createLogger } from '../telemetry/Logger';

const log = createLogger('VectorIndexFactory');

export function createVectorIndex(
  db: ThunderDb,
  workspace: string,
  config: IndexingConfig
): VectorIndex {
  if (config.vectorsEnabled && config.vectorBackend === 'lancedb' && isLanceDbAvailable()) {
    log.info('Using LanceDB vector backend', { workspace });
    return new LanceDbVectorIndex(db, workspace);
  }
  return new SqliteVectorIndex(db);
}

export function describeVectorBackend(config: IndexingConfig): string {
  if (!config.vectorsEnabled) return 'none';
  if (config.vectorBackend === 'lancedb' && isLanceDbAvailable()) return 'lancedb';
  return 'sqlite';
}
