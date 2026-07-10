import { existsSync, statSync } from 'fs';
import type { ThunderDb } from './ThunderDb';
import { checkDbHealth, type DbHealthReport } from './health';
import { FtsIndex } from './FtsIndex';

export interface IndexStatusReport {
  workspace: string;
  filesIndexed: number;
  filesTotal: number;
  chunks: number;
  symbols: number;
  queued: number;
  failed: number;
  running: boolean;
  dbPath?: string;
  dbSizeBytes?: number;
  lastIndexedAt?: number;
  health: DbHealthReport;
}

export interface IndexRepairReport {
  removedFiles: number;
  rebuiltFtsChunks: number;
  vacuumed: boolean;
  health: DbHealthReport;
}

export class IndexMaintenanceService {
  constructor(
    private readonly db: ThunderDb,
    private readonly workspace: string,
    private readonly dbPath?: string
  ) {}

  status(queue?: { queued?: number; failed?: number; running?: boolean }): IndexStatusReport {
    const files = this.db.raw.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN indexed_at IS NOT NULL THEN 1 ELSE 0 END) as indexed,
        MAX(indexed_at) as lastIndexedAt
      FROM files
      WHERE workspace = ?
    `).get(this.workspace) as { total: number; indexed: number | null; lastIndexedAt: number | null };
    const chunks = this.count('chunks');
    const symbols = this.count('symbols');
    const dbSizeBytes = this.dbPath && existsSync(this.dbPath) ? statSync(this.dbPath).size : undefined;
    return {
      workspace: this.workspace,
      filesIndexed: files.indexed ?? 0,
      filesTotal: files.total,
      chunks,
      symbols,
      queued: queue?.queued ?? 0,
      failed: queue?.failed ?? 0,
      running: queue?.running ?? false,
      dbPath: this.dbPath,
      dbSizeBytes,
      lastIndexedAt: files.lastIndexedAt ?? undefined,
      health: checkDbHealth(this.db),
    };
  }

  removeFile(relPath: string): boolean {
    const row = this.db.raw
      .prepare('SELECT id FROM files WHERE workspace = ? AND rel_path = ?')
      .get(this.workspace, relPath) as { id: number } | undefined;
    new FtsIndex(this.db).deleteByFile(relPath);
    if (!row) return false;
    this.db.raw.prepare('DELETE FROM files WHERE id = ?').run(row.id);
    return true;
  }

  repair(): IndexRepairReport {
    let removedFiles = 0;
    let rebuiltFtsChunks = 0;
    this.db.transaction(() => {
      const rows = this.db.raw
        .prepare('SELECT id, path, rel_path FROM files WHERE workspace = ?')
        .all(this.workspace) as Array<{ id: number; path: string; rel_path: string }>;
      for (const row of rows) {
        if (!existsSync(row.path)) {
          new FtsIndex(this.db).deleteByFile(row.rel_path);
          this.db.raw.prepare('DELETE FROM files WHERE id = ?').run(row.id);
          removedFiles += 1;
        }
      }

      this.db.raw.prepare('DELETE FROM fts_chunks').run();
      const chunks = this.db.raw.prepare(`
        SELECT files.rel_path as relPath, chunks.content as content
        FROM chunks
        JOIN files ON files.id = chunks.file_id
        WHERE files.workspace = ?
      `).all(this.workspace) as Array<{ relPath: string; content: string }>;
      const insert = this.db.raw.prepare('INSERT INTO fts_chunks (rel_path, content) VALUES (?, ?)');
      for (const chunk of chunks) {
        insert.run(chunk.relPath, chunk.content);
        rebuiltFtsChunks += 1;
      }
    });

    let vacuumed = false;
    try {
      this.db.raw.pragma('wal_checkpoint(TRUNCATE)');
      this.db.raw.exec('VACUUM');
      vacuumed = true;
    } catch {
      vacuumed = false;
    }

    return {
      removedFiles,
      rebuiltFtsChunks,
      vacuumed,
      health: checkDbHealth(this.db),
    };
  }

  private count(table: string): number {
    return (this.db.raw.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
  }
}
