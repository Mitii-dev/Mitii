import { mkdirSync } from 'fs';
import { join } from 'path';
import type { ThunderDb } from './ThunderDb';
import { cosineSimilarity } from './EmbeddingProvider';
import { createLogger } from '../telemetry/Logger';
import type { VectorIndex, VectorSearchResult } from './VectorIndex';
import { resolveThunderDir } from './paths';
import { summarizeHealthDetail, type ComponentHealth } from './ComponentHealth';

const log = createLogger('LanceDbVectorIndex');

type LanceTable = {
  add(rows: LanceRow[]): Promise<void>;
  delete(predicate: string): Promise<void>;
  search(vector: number[]): { limit(n: number): { toArray(): Promise<LanceRow[]> } };
  countRows(): Promise<number>;
};

type LanceDb = {
  openTable(name: string): Promise<LanceTable>;
  createTable(name: string, rows: LanceRow[]): Promise<LanceTable>;
};

type LanceRow = {
  chunk_id: number;
  workspace: string;
  rel_path: string;
  content: string;
  vector: number[];
};

const TABLE_NAME = 'chunk_embeddings';

export class LanceDbVectorIndex implements VectorIndex {
  private connectionPromise: Promise<LanceDb | null> | null = null;
  private creatingPromise: Promise<LanceTable | null> | null = null;
  private creatingChunkId: number | null = null;
  private table: LanceTable | null = null;
  private health: ComponentHealth = { status: 'unknown' };

  constructor(
    private readonly sqliteDb: ThunderDb,
    private readonly workspace: string
  ) {}

  private lanceDir(): string {
    const base = join(resolveThunderDir(this.workspace), 'lance');
    mkdirSync(base, { recursive: true });
    return base;
  }

  private async getConnection(): Promise<LanceDb | null> {
    if (!this.connectionPromise) {
      this.connectionPromise = this.connect();
    }
    return this.connectionPromise;
  }

  private async connect(): Promise<LanceDb | null> {
    try {
      const lancedb = await import('@lancedb/lancedb');
      const connect = (lancedb as unknown as { connect: (uri: string) => Promise<LanceDb> }).connect;
      const db = await connect(this.lanceDir());
      this.health = { status: 'ready' };
      return db;
    } catch (error) {
      const fullDetail = error instanceof Error ? error.message : String(error);
      this.health = { status: 'degraded', detail: summarizeHealthDetail(error) };
      log.warn('LanceDB unavailable, falling back to SQLite vector scan for this session', { error: fullDetail });
      return null;
    }
  }

  /** Read-only lookup: returns null if the table hasn't been created yet (no chunks embedded so
   * far) — that's a normal, non-degraded state, not an error. Creation happens lazily in
   * upsertLanceRow() once we have a real row to infer the schema from (LanceDB's `createTable`
   * needs a non-empty seed row or an explicit Arrow schema; it can't create a table from `[]`). */
  private async getTable(): Promise<LanceTable | null> {
    if (this.table) return this.table;
    const db = await this.getConnection();
    if (!db) return null;

    try {
      this.table = await db.openTable(TABLE_NAME);
      return this.table;
    } catch {
      return null;
    }
  }

  /** Returns the table plus whether `seedRow` was the one used to create it (in which case it's
   * already inserted — no separate add() needed) or another concurrent caller's row won the race
   * to create the table first (in which case the caller still needs to add its own row). */
  private async getOrCreateTable(seedRow: LanceRow): Promise<{ table: LanceTable; seeded: boolean } | null> {
    const existing = await this.getTable();
    if (existing) return { table: existing, seeded: false };

    // Guard against concurrent first-inserts racing to create the table twice — only one
    // creation attempt runs; concurrent callers await and share its result.
    if (!this.creatingPromise) {
      this.creatingChunkId = seedRow.chunk_id;
      this.creatingPromise = this.createTableWithSeed(seedRow);
    }
    const table = await this.creatingPromise;
    if (!table) return null;
    return { table, seeded: this.creatingChunkId === seedRow.chunk_id };
  }

  private async createTableWithSeed(seedRow: LanceRow): Promise<LanceTable | null> {
    const db = await this.getConnection();
    if (!db) return null;

    try {
      this.table = await db.createTable(TABLE_NAME, [seedRow]);
      return this.table;
    } catch (error) {
      log.warn('LanceDB table creation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  getHealth(): ComponentHealth {
    return this.health;
  }

  /** Brute-force SQLite fallback: used only when the LanceDB native table failed to open
   * (see getHealth()) or its own ANN search threw. Not the normal path when LanceDB is healthy. */
  search(workspace: string, queryEmbedding: number[], limit = 10): VectorSearchResult[] {
    if (queryEmbedding.length === 0) return [];
    log.debug('sqlite-fallback:search', { workspace, backendHealth: this.health.status });

    const rows = this.sqliteDb.raw.prepare(`
      SELECT ve.chunk_id, c.content, f.rel_path, ve.embedding_json
      FROM chunk_embeddings ve
      JOIN chunks c ON c.id = ve.chunk_id
      JOIN files f ON f.id = c.file_id
      WHERE ve.workspace = ?
      LIMIT 500
    `).all(workspace) as Array<{
      chunk_id: number;
      content: string;
      rel_path: string;
      embedding_json: string;
    }>;

    return rows
      .map((row) => {
        const embedding = JSON.parse(row.embedding_json) as number[];
        return {
          chunkId: row.chunk_id,
          relPath: row.rel_path,
          content: row.content,
          score: cosineSimilarity(queryEmbedding, embedding),
        };
      })
      .filter((r) => r.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async searchAsync(workspace: string, queryEmbedding: number[], limit = 10): Promise<VectorSearchResult[]> {
    if (queryEmbedding.length === 0) return [];
    const table = await this.getTable();
    if (!table) return this.search(workspace, queryEmbedding, limit);

    try {
      // Over-fetch because LanceDB's ANN search isn't filtered by workspace server-side —
      // we filter client-side below, so we need extra candidates to still hit `limit` after that.
      // Once filtered, we trust LanceDB's own nearest-neighbor order (that's the whole point of
      // using its native index) rather than recomputing cosine similarity and re-sorting in JS.
      const rows = await table.search(queryEmbedding).limit(limit * 3).toArray();
      const results = rows
        .filter((row) => row.workspace === workspace)
        .slice(0, limit)
        .map((row) => ({
          chunkId: row.chunk_id,
          relPath: row.rel_path,
          content: row.content,
          score: cosineSimilarity(queryEmbedding, row.vector),
        }));
      log.debug('lancedb:search', { workspace, candidateCount: rows.length, resultCount: results.length });
      return results;
    } catch (error) {
      log.warn('LanceDB search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.search(workspace, queryEmbedding, limit);
    }
  }

  upsertChunk(workspace: string, chunkId: number, relPath: string, embedding: number[]): void {
    this.sqliteDb.raw.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, workspace, embedding_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at
    `).run(chunkId, workspace, JSON.stringify(embedding), Date.now());

    void this.upsertLanceRow(workspace, chunkId, relPath, embedding);
  }

  private async upsertLanceRow(
    workspace: string,
    chunkId: number,
    relPath: string,
    embedding: number[]
  ): Promise<void> {
    try {
      const contentRow = this.sqliteDb.raw
        .prepare('SELECT content FROM chunks WHERE id = ?')
        .get(chunkId) as { content: string } | undefined;

      const row: LanceRow = {
        chunk_id: chunkId,
        workspace,
        rel_path: relPath,
        content: contentRow?.content ?? '',
        vector: embedding,
      };

      const existing = await this.getTable();
      if (existing) {
        await existing.delete(`chunk_id = ${chunkId}`);
        await existing.add([row]);
        return;
      }

      // No table yet: this row seeds it (createTable() inserts it directly, no separate add()) —
      // unless a concurrent upsert's row won the race to create the table first, in which case
      // this row still needs to be added.
      const result = await this.getOrCreateTable(row);
      if (result && !result.seeded) {
        await result.table.add([row]);
      }
    } catch (error) {
      log.warn('LanceDB upsert failed', {
        chunkId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  deleteFileChunks(fileId: number): void {
    const chunkIds = this.sqliteDb.raw
      .prepare('SELECT id FROM chunks WHERE file_id = ?')
      .all(fileId) as Array<{ id: number }>;

    this.sqliteDb.raw.prepare(`
      DELETE FROM chunk_embeddings
      WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?)
    `).run(fileId);

    void (async () => {
      const table = await this.getTable();
      if (!table) return;
      for (const row of chunkIds) {
        try {
          await table.delete(`chunk_id = ${row.id}`);
        } catch {
          // Non-fatal
        }
      }
    })();
  }

  count(workspace: string): number {
    const row = this.sqliteDb.raw
      .prepare('SELECT COUNT(*) as cnt FROM chunk_embeddings WHERE workspace = ?')
      .get(workspace) as { cnt: number };
    return row.cnt;
  }
}

export function isLanceDbAvailable(): boolean {
  try {
    require.resolve('@lancedb/lancedb');
    return true;
  } catch {
    return false;
  }
}
