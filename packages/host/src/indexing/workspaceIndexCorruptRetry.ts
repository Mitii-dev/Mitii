import { rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  INDEX_DB_FILE,
  INDEX_RUNTIME_FILE,
  LANCEDB_DIR,
} from './indexArtifactPaths.js';
import { runFullWorkspaceIndexOnce } from './runFullWorkspaceIndexOnce.js';
import { emitProgress } from './workspaceIndexProgress.js';
import type {
  FullWorkspaceIndexOptions,
  FullWorkspaceIndexResult,
} from './workspaceIndexTypes.js';

export async function runWithCorruptRetry(
  options: FullWorkspaceIndexOptions,
): Promise<FullWorkspaceIndexResult> {
  try {
    return await runFullWorkspaceIndexOnce(options);
  } catch (error) {
    if (!isCorruptIndexError(error)) {
      throw error;
    }
    emitProgress(options.mitiiDir, options.onProgress, {
      stage: 'rebuilding_corrupt',
      message: 'Index store is corrupt; rebuilding',
    });
    removeCorruptIndexArtifacts(options.mitiiDir);
    return runFullWorkspaceIndexOnce({
      ...options,
      force: true,
    });
  }
}

export function isCorruptIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : '';
  return /SQLITE_CORRUPT|SQLITE_NOTADB|SQLITE_IOERR|SQLITE_FULL|database disk image is malformed|not a database|file is not a database/i.test(
    `${message}\n${cause}`,
  );
}

export function removeCorruptIndexArtifacts(mitiiDir: string): void {
  for (const name of [INDEX_DB_FILE, `${INDEX_DB_FILE}-wal`, `${INDEX_DB_FILE}-shm`, LANCEDB_DIR, INDEX_RUNTIME_FILE]) {
    rmSync(join(mitiiDir, name), { recursive: true, force: true });
  }
}
