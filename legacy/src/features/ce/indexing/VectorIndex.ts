import type { ThunderDb } from './ThunderDb';
import { cosineSimilarity, type EmbeddingProvider } from './EmbeddingProvider';
import type { LanceDbVectorIndex } from './LanceDbVectorIndex';
import { createLogger } from '../../../kernel/telemetry/Logger';
import type { ComponentHealth } from './ComponentHealth';

const log = createLogger('VectorIndex');

export interface VectorSearchResult {
  chunkId: number;
  relPath: string;
  content: string;
  score: number;
}

export interface VectorIndex {
  search(workspace: string, queryEmbedding: number[], limit?: number): VectorSearchResult[];
  upsertChunk(workspace: string, chunkId: number, relPath: string, embedding: number[]): void | Promise<void>;
  deleteFileChunks(fileId: number): void | Promise<void>;
  count(workspace: string): number;
  /** Runtime health (e.g. did the LanceDB native table actually open?). Omit if always healthy. */
  getHealth?(): ComponentHealth;
}

/** SQLite-backed vector store. LanceDB can replace this when enabled later. */
export class SqliteVectorIndex implements VectorIndex {
  constructor(private readonly db: ThunderDb) {}

  search(workspace: string, queryEmbedding: number[], limit = 10): VectorSearchResult[] {
    if (queryEmbedding.length === 0) return [];

    const rows = this.db.raw.prepare(`
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

  upsertChunk(workspace: string, chunkId: number, _relPath: string, embedding: number[]): void {
    this.db.raw.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, workspace, embedding_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at
    `).run(chunkId, workspace, JSON.stringify(embedding), Date.now());
  }

  deleteFileChunks(fileId: number): void {
    this.db.raw.prepare(`
      DELETE FROM chunk_embeddings
      WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?)
    `).run(fileId);
  }

  count(workspace: string): number {
    const row = this.db.raw
      .prepare('SELECT COUNT(*) as cnt FROM chunk_embeddings WHERE workspace = ?')
      .get(workspace) as { cnt: number };
    return row.cnt;
  }
}

export class VectorIndexService {
  constructor(
    private readonly index: VectorIndex,
    private readonly embedder: EmbeddingProvider
  ) {}

  async search(workspace: string, query: string, limit = 8): Promise<VectorSearchResult[]> {
    const [embedding] = await this.embedder.embed([query]);
    if (!embedding.length) return [];

    if ('searchAsync' in this.index && typeof this.index.searchAsync === 'function') {
      return (this.index as LanceDbVectorIndex).searchAsync(workspace, embedding, limit);
    }

    return this.index.search(workspace, embedding, limit);
  }

  async indexChunk(workspace: string, chunkId: number, relPath: string, content: string): Promise<void> {
    try {
      const [embedding] = await this.embedder.embed([content.slice(0, 2000)]);
      if (embedding.length > 0) {
        await this.index.upsertChunk(workspace, chunkId, relPath, embedding);
      }
    } catch (error) {
      log.warn('Chunk embedding failed', {
        relPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async deleteFileChunks(fileId: number): Promise<void> {
    await this.index.deleteFileChunks(fileId);
  }

  count(workspace: string): number {
    return this.index.count(workspace);
  }

  /** Runtime health of the embedder and the vector backend, for UI/status surfacing. */
  getHealth(): { embedder: ComponentHealth; backend: ComponentHealth } {
    return {
      embedder: this.embedder.getHealth?.() ?? { status: 'unknown' },
      backend: this.index.getHealth?.() ?? { status: 'unknown' },
    };
  }
}
